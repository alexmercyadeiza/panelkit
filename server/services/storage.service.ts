// ─── Storage Management Service ──────────────────────────────────────────────

import { eq, desc, and } from "drizzle-orm";
import { type AppDatabase, getDb } from "../db";
import { storageBuckets, storageFiles } from "../db/schema";
import { generateId } from "./crypto.service";
import { generateSignedUrl, verifySignedUrl } from "../lib/signed-url";
import { getConfig } from "../config";
import { join, resolve, relative, normalize } from "path";
import { existsSync, mkdirSync, unlinkSync, readdirSync, statSync, rmSync } from "fs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BucketRecord {
  id: string;
  name: string;
  isPublic: boolean;
  maxSizeBytes: number | null;
  currentSizeBytes: number;
  createdAt: string;
}

export interface FileRecord {
  id: string;
  bucketId: string;
  path: string;
  sizeBytes: number;
  mimeType: string | null;
  createdAt: string;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  sizeBytes?: number;
  mimeType?: string | null;
  children?: FileTreeEntry[];
}

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const SIGNING_SECRET_FALLBACK = "panelkit-storage-signing-secret";

function getSigningSecret(): string {
  try {
    const config = getConfig();
    return config.MASTER_KEY || SIGNING_SECRET_FALLBACK;
  } catch {
    return SIGNING_SECRET_FALLBACK;
  }
}

// ─── Path Validation ─────────────────────────────────────────────────────────

/**
 * Validate a file path to prevent path traversal and null byte attacks.
 * Returns the sanitized path or throws.
 */
export function validateFilePath(filePath: string): string {
  // Block null bytes
  if (filePath.includes("\0")) {
    throw new StorageError("File path contains null bytes", 400);
  }

  // Normalize and check for traversal
  const normalized = normalize(filePath).replace(/^\/+/, "");

  if (normalized.startsWith("..") || normalized.includes("/..") || normalized.includes("\\..")) {
    throw new StorageError("Path traversal detected", 400);
  }

  // Block empty paths
  if (normalized.length === 0) {
    throw new StorageError("File path cannot be empty", 400);
  }

  // Block absolute paths
  if (filePath.startsWith("/") || /^[a-zA-Z]:/.test(filePath)) {
    throw new StorageError("Absolute paths are not allowed", 400);
  }

  // Block hidden files/directories (starting with .)
  const parts = normalized.split("/");
  for (const part of parts) {
    if (part.startsWith(".")) {
      throw new StorageError("Hidden files/directories are not allowed", 400);
    }
  }

  return normalized;
}

// ─── MIME Type Detection ─────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".xml": "application/xml",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

function detectMimeType(filePath: string): string | null {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Get the storage base path (configurable for testing).
 */
export function getStorageBasePath(basePath?: string): string {
  if (basePath) return basePath;
  try {
    const config = getConfig();
    return join(config.DATA_DIR, "storage");
  } catch {
    return "/var/panelkit/storage";
  }
}

/**
 * Create a new storage bucket.
 */
export async function createBucket(
  name: string,
  options?: {
    isPublic?: boolean;
    maxSizeBytes?: number | null;
  },
  db?: AppDatabase,
  basePath?: string
): Promise<BucketRecord> {
  const database = db || getDb();

  // Validate name
  if (!name || name.length === 0) {
    throw new StorageError("Bucket name is required", 400);
  }

  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new StorageError(
      "Bucket name must be lowercase alphanumeric, starting with letter/digit, with dots, dashes, or underscores",
      400
    );
  }

  if (name.length > 63) {
    throw new StorageError("Bucket name too long (max 63 characters)", 400);
  }

  // Check for duplicates
  const existing = await database.query.storageBuckets.findFirst({
    where: eq(storageBuckets.name, name),
  });

  if (existing) {
    throw new StorageError(`Bucket "${name}" already exists`, 409);
  }

  // Create directory on disk
  const storagePath = getStorageBasePath(basePath);
  const bucketDir = join(storagePath, name);

  try {
    mkdirSync(bucketDir, { recursive: true });
  } catch (err) {
    throw new StorageError(`Failed to create bucket directory: ${(err as Error).message}`, 500);
  }

  // Insert into database
  const id = generateId();
  const now = new Date().toISOString();

  await database.insert(storageBuckets).values({
    id,
    name,
    isPublic: options?.isPublic ?? false,
    maxSizeBytes: options?.maxSizeBytes ?? null,
    currentSizeBytes: 0,
    createdAt: now,
  });

  return {
    id,
    name,
    isPublic: options?.isPublic ?? false,
    maxSizeBytes: options?.maxSizeBytes ?? null,
    currentSizeBytes: 0,
    createdAt: now,
  };
}

/**
 * List all storage buckets.
 */
export async function listBuckets(db?: AppDatabase): Promise<BucketRecord[]> {
  const database = db || getDb();

  const rows = await database
    .select()
    .from(storageBuckets)
    .orderBy(desc(storageBuckets.createdAt));

  return rows;
}

/**
 * Get a single bucket by ID.
 */
export async function getBucket(
  id: string,
  db?: AppDatabase
): Promise<BucketRecord | null> {
  const database = db || getDb();

  const row = await database.query.storageBuckets.findFirst({
    where: eq(storageBuckets.id, id),
  });

  return row || null;
}

/**
 * Delete a storage bucket and all its files.
 */
export async function deleteBucket(
  id: string,
  db?: AppDatabase,
  basePath?: string
): Promise<void> {
  const database = db || getDb();

  const bucket = await database.query.storageBuckets.findFirst({
    where: eq(storageBuckets.id, id),
  });

  if (!bucket) {
    throw new StorageError("Bucket not found", 404);
  }

  // Remove directory from disk
  const storagePath = getStorageBasePath(basePath);
  const bucketDir = join(storagePath, bucket.name);

  try {
    if (existsSync(bucketDir)) {
      rmSync(bucketDir, { recursive: true, force: true });
    }
  } catch {
    // Best effort cleanup
  }

  // Delete from database (cascade deletes files)
  await database.delete(storageBuckets).where(eq(storageBuckets.id, id));
}

/**
 * Upload a file to a bucket.
 */
export async function uploadFile(
  bucketId: string,
  filePath: string,
  content: Buffer | Uint8Array,
  options?: {
    mimeType?: string;
    maxFileSize?: number;
  },
  db?: AppDatabase,
  basePath?: string
): Promise<FileRecord> {
  const database = db || getDb();

  // Validate file path
  const sanitizedPath = validateFilePath(filePath);

  // Get bucket
  const bucket = await database.query.storageBuckets.findFirst({
    where: eq(storageBuckets.id, bucketId),
  });

  if (!bucket) {
    throw new StorageError("Bucket not found", 404);
  }

  // Check file size
  const maxSize = options?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  if (content.length > maxSize) {
    throw new StorageError(
      `File size ${content.length} exceeds maximum ${maxSize} bytes`,
      413
    );
  }

  // Check bucket quota
  if (bucket.maxSizeBytes !== null) {
    const newSize = bucket.currentSizeBytes + content.length;
    if (newSize > bucket.maxSizeBytes) {
      throw new StorageError(
        `Upload would exceed bucket quota (${bucket.currentSizeBytes} + ${content.length} > ${bucket.maxSizeBytes})`,
        413
      );
    }
  }

  // Write to disk
  const storagePath = getStorageBasePath(basePath);
  const fullPath = join(storagePath, bucket.name, sanitizedPath);

  // Verify the resolved path is within the bucket directory
  const bucketDir = resolve(join(storagePath, bucket.name));
  const resolvedPath = resolve(fullPath);
  if (!resolvedPath.startsWith(bucketDir + "/") && resolvedPath !== bucketDir) {
    throw new StorageError("Path traversal detected", 400);
  }

  // Create parent directories
  const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  if (parentDir) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Check if file already exists in DB — if so, update it
  const existingFile = await database.query.storageFiles.findFirst({
    where: and(
      eq(storageFiles.bucketId, bucketId),
      eq(storageFiles.path, sanitizedPath)
    ),
  });

  try {
    await Bun.write(fullPath, content);
  } catch (err) {
    throw new StorageError(`Failed to write file: ${(err as Error).message}`, 500);
  }

  const mimeType = options?.mimeType || detectMimeType(sanitizedPath);
  const now = new Date().toISOString();

  if (existingFile) {
    // Update existing file record
    const sizeDiff = content.length - existingFile.sizeBytes;

    await database
      .update(storageFiles)
      .set({
        sizeBytes: content.length,
        mimeType,
        createdAt: now,
      })
      .where(eq(storageFiles.id, existingFile.id));

    // Update bucket size
    await database
      .update(storageBuckets)
      .set({
        currentSizeBytes: bucket.currentSizeBytes + sizeDiff,
      })
      .where(eq(storageBuckets.id, bucketId));

    return {
      id: existingFile.id,
      bucketId,
      path: sanitizedPath,
      sizeBytes: content.length,
      mimeType,
      createdAt: now,
    };
  }

  // Insert new file record
  const id = generateId();

  await database.insert(storageFiles).values({
    id,
    bucketId,
    path: sanitizedPath,
    sizeBytes: content.length,
    mimeType,
    createdAt: now,
  });

  // Update bucket size
  await database
    .update(storageBuckets)
    .set({
      currentSizeBytes: bucket.currentSizeBytes + content.length,
    })
    .where(eq(storageBuckets.id, bucketId));

  return {
    id,
    bucketId,
    path: sanitizedPath,
    sizeBytes: content.length,
    mimeType,
    createdAt: now,
  };
}

/**
 * List files in a bucket, organized hierarchically.
 */
export async function listFiles(
  bucketId: string,
  prefix?: string,
  db?: AppDatabase
): Promise<FileTreeEntry[]> {
  const database = db || getDb();

  // Get bucket
  const bucket = await database.query.storageBuckets.findFirst({
    where: eq(storageBuckets.id, bucketId),
  });

  if (!bucket) {
    throw new StorageError("Bucket not found", 404);
  }

  // Get all files for this bucket
  const files = await database
    .select()
    .from(storageFiles)
    .where(eq(storageFiles.bucketId, bucketId));

  // Filter by prefix if given
  const filtered = prefix
    ? files.filter((f) => f.path.startsWith(prefix))
    : files;

  // Build hierarchical tree
  return buildFileTree(filtered);
}

/**
 * Build a hierarchical file tree from flat file records.
 */
function buildFileTree(
  files: { path: string; sizeBytes: number; mimeType: string | null }[]
): FileTreeEntry[] {
  const root: FileTreeEntry[] = [];
  const dirs = new Map<string, FileTreeEntry>();

  for (const file of files) {
    const parts = file.path.split("/");

    if (parts.length === 1) {
      // Top-level file
      root.push({
        name: parts[0],
        path: file.path,
        type: "file",
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
      });
    } else {
      // Nested file — ensure parent directories exist
      let currentPath = "";
      let currentChildren = root;

      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

        let dir = dirs.get(currentPath);
        if (!dir) {
          dir = {
            name: parts[i],
            path: currentPath,
            type: "directory",
            children: [],
          };
          dirs.set(currentPath, dir);
          currentChildren.push(dir);
        }
        currentChildren = dir.children!;
      }

      // Add file to innermost directory
      currentChildren.push({
        name: parts[parts.length - 1],
        path: file.path,
        type: "file",
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
      });
    }
  }

  return root;
}

/**
 * Delete a file from a bucket.
 */
export async function deleteFile(
  bucketId: string,
  filePath: string,
  db?: AppDatabase,
  basePath?: string
): Promise<void> {
  const database = db || getDb();

  // Validate path
  const sanitizedPath = validateFilePath(filePath);

  // Get bucket
  const bucket = await database.query.storageBuckets.findFirst({
    where: eq(storageBuckets.id, bucketId),
  });

  if (!bucket) {
    throw new StorageError("Bucket not found", 404);
  }

  // Find file record
  const file = await database.query.storageFiles.findFirst({
    where: and(
      eq(storageFiles.bucketId, bucketId),
      eq(storageFiles.path, sanitizedPath)
    ),
  });

  if (!file) {
    throw new StorageError("File not found", 404);
  }

  // Delete from disk
  const storagePath = getStorageBasePath(basePath);
  const fullPath = join(storagePath, bucket.name, sanitizedPath);

  try {
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
  } catch {
    // Best effort — file might already be gone
  }

  // Update bucket size
  const newSize = Math.max(0, bucket.currentSizeBytes - file.sizeBytes);
  await database
    .update(storageBuckets)
    .set({ currentSizeBytes: newSize })
    .where(eq(storageBuckets.id, bucketId));

  // Delete from database
  await database.delete(storageFiles).where(eq(storageFiles.id, file.id));
}

/**
 * Generate a signed URL for accessing a file in a private bucket.
 */
export async function getFileUrl(
  bucketId: string,
  filePath: string,
  baseUrl: string,
  expiresInSeconds: number = 3600,
  db?: AppDatabase
): Promise<{ url: string; isPublic: boolean }> {
  const database = db || getDb();

  const sanitizedPath = validateFilePath(filePath);

  // Get bucket
  const bucket = await database.query.storageBuckets.findFirst({
    where: eq(storageBuckets.id, bucketId),
  });

  if (!bucket) {
    throw new StorageError("Bucket not found", 404);
  }

  // Check file exists
  const file = await database.query.storageFiles.findFirst({
    where: and(
      eq(storageFiles.bucketId, bucketId),
      eq(storageFiles.path, sanitizedPath)
    ),
  });

  if (!file) {
    throw new StorageError("File not found", 404);
  }

  const urlPath = `/api/storage/buckets/${bucketId}/files/${sanitizedPath}`;

  if (bucket.isPublic) {
    // Public bucket — return direct URL
    return {
      url: `${baseUrl}${urlPath}`,
      isPublic: true,
    };
  }

  // Private bucket — generate signed URL
  const secret = getSigningSecret();
  const signedUrl = await generateSignedUrl(
    baseUrl,
    urlPath,
    secret,
    expiresInSeconds
  );

  return {
    url: signedUrl,
    isPublic: false,
  };
}

/**
 * Verify a signed URL for a private bucket file.
 */
export async function verifyFileAccess(
  bucketId: string,
  filePath: string,
  expires: string | undefined,
  signature: string | undefined,
  db?: AppDatabase
): Promise<{ allowed: boolean; reason?: string }> {
  const database = db || getDb();

  // Get bucket
  const bucket = await database.query.storageBuckets.findFirst({
    where: eq(storageBuckets.id, bucketId),
  });

  if (!bucket) {
    return { allowed: false, reason: "Bucket not found" };
  }

  // Public buckets allow all access
  if (bucket.isPublic) {
    return { allowed: true };
  }

  // Private bucket — require valid signature
  if (!expires || !signature) {
    return { allowed: false, reason: "Signed URL required for private buckets" };
  }

  const urlPath = `/api/storage/buckets/${bucketId}/files/${filePath}`;
  const secret = getSigningSecret();

  const result = await verifySignedUrl(urlPath, expires, signature, secret);
  return { allowed: result.valid, reason: result.reason };
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class StorageError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "StorageError";
  }
}
