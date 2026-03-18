// ─── Storage API Routes ──────────────────────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import {
  createBucket,
  listBuckets,
  getBucket,
  deleteBucket,
  uploadFile,
  listFiles,
  deleteFile,
  getFileUrl,
  StorageError,
} from "../services/storage.service";

const storageRoutes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createBucketSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(63, "Name too long (max 63 characters)")
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      "Name must be lowercase alphanumeric, starting with letter/digit"
    ),
  isPublic: z.boolean().default(false),
  maxSizeBytes: z.number().int().positive().nullable().optional(),
});

// ─── Auth middleware for all routes ─────────────────────────────────────────

storageRoutes.use("*", authMiddleware);

// ─── POST /api/storage/buckets — Create a new bucket ─────────────────────────

storageRoutes.post("/buckets", async (c) => {
  const body = await c.req.json();
  const parsed = createBucketSchema.parse(body);

  const bucket = await createBucket(parsed.name, {
    isPublic: parsed.isPublic,
    maxSizeBytes: parsed.maxSizeBytes ?? null,
  });

  return c.json({ bucket }, 201);
});

// ─── GET /api/storage/buckets — List all buckets ─────────────────────────────

storageRoutes.get("/buckets", async (c) => {
  const buckets = await listBuckets();
  return c.json({ buckets });
});

// ─── GET /api/storage/buckets/:id — Get a single bucket ──────────────────────

storageRoutes.get("/buckets/:id", async (c) => {
  const id = c.req.param("id");
  const bucket = await getBucket(id);

  if (!bucket) {
    return c.json({ error: "Bucket not found" }, 404);
  }

  return c.json({ bucket });
});

// ─── DELETE /api/storage/buckets/:id — Delete a bucket ───────────────────────

storageRoutes.delete("/buckets/:id", async (c) => {
  const id = c.req.param("id");
  await deleteBucket(id);
  return c.json({ success: true });
});

// ─── GET /api/storage/buckets/:id/files — List files in a bucket ─────────────

storageRoutes.get("/buckets/:id/files", async (c) => {
  const id = c.req.param("id");
  const prefix = c.req.query("prefix");

  const files = await listFiles(id, prefix || undefined);
  return c.json({ files });
});

// ─── POST /api/storage/buckets/:id/upload — Upload a file ────────────────────

storageRoutes.post("/buckets/:id/upload", async (c) => {
  const id = c.req.param("id");

  // Support multipart form data
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const path = formData.get("path") as string | null;

  if (!file) {
    return c.json({ error: "No file provided" }, 400);
  }

  const filePath = path || file.name;
  if (!filePath) {
    return c.json({ error: "File path is required" }, 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const record = await uploadFile(id, filePath, buffer, {
    mimeType: file.type || undefined,
  });

  return c.json({ file: record }, 201);
});

// ─── DELETE /api/storage/buckets/:id/files/:path — Delete a file ─────────────

storageRoutes.delete("/buckets/:id/files/*", async (c) => {
  const id = c.req.param("id");
  // Extract the full file path from the wildcard
  const url = new URL(c.req.url);
  const prefix = `/api/storage/buckets/${id}/files/`;
  const filePath = decodeURIComponent(url.pathname.slice(prefix.length));

  if (!filePath) {
    return c.json({ error: "File path is required" }, 400);
  }

  await deleteFile(id, filePath);
  return c.json({ success: true });
});

// ─── GET /api/storage/buckets/:id/files/:path/url — Get signed URL ──────────

storageRoutes.get("/buckets/:id/url/*", async (c) => {
  const id = c.req.param("id");
  const url = new URL(c.req.url);
  const prefix = `/api/storage/buckets/${id}/url/`;
  const filePath = decodeURIComponent(url.pathname.slice(prefix.length));

  if (!filePath) {
    return c.json({ error: "File path is required" }, 400);
  }

  const expiresIn = parseInt(c.req.query("expiresIn") || "3600", 10);
  const baseUrl = `${url.protocol}//${url.host}`;

  const result = await getFileUrl(id, filePath, baseUrl, expiresIn);
  return c.json(result);
});

export { storageRoutes };
