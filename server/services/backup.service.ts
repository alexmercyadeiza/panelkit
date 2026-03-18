// ─── Backup Service ─────────────────────────────────────────────────────────

import { type AppDatabase } from "../db";
import { generateId } from "./crypto.service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BackupMeta {
  id: string;
  type: "manual" | "scheduled";
  timestamp: string;
  size: number;
  checksum: string;
  filename: string;
  description?: string;
}

export interface BackupConfig {
  basePath: string;
  keepDaily: number;
  keepWeekly: number;
  dbPath?: string;
}

export interface BackupResult {
  success: boolean;
  backup?: BackupMeta;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  error?: string;
}

// ─── Mockable Interfaces ────────────────────────────────────────────────────

export interface FileSystemOps {
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  readDir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ size: number; mtime: Date }>;
  exists(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
}

export interface DatabaseDumpOps {
  dumpSqlite(dbPath: string, outputPath: string): Promise<void>;
  restoreSqlite(dumpPath: string, dbPath: string): Promise<void>;
}

// ─── Default Implementations ────────────────────────────────────────────────

import { promises as fs } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";

export const defaultFileSystemOps: FileSystemOps = {
  async mkdir(path, opts) {
    await fs.mkdir(path, opts);
  },
  async writeFile(path, data) {
    await fs.writeFile(path, data);
  },
  async readFile(path) {
    return new Uint8Array(await fs.readFile(path));
  },
  async readDir(path) {
    return await fs.readdir(path);
  },
  async stat(path) {
    const s = await fs.stat(path);
    return { size: s.size, mtime: s.mtime };
  },
  async exists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  },
  async unlink(path) {
    await fs.unlink(path);
  },
  async copyFile(src, dest) {
    await fs.copyFile(src, dest);
  },
};

export const defaultDatabaseDumpOps: DatabaseDumpOps = {
  async dumpSqlite(dbPath, outputPath) {
    const proc = Bun.spawn(["sqlite3", dbPath, `.backup '${outputPath}'`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new BackupError(`SQLite dump failed: ${stderr}`, 500);
    }
  },
  async restoreSqlite(dumpPath, dbPath) {
    const proc = Bun.spawn(["sqlite3", dbPath, `.restore '${dumpPath}'`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new BackupError(`SQLite restore failed: ${stderr}`, 500);
    }
  },
};

// ─── Backup Service ─────────────────────────────────────────────────────────

const MANIFEST_FILE = "backups.json";

async function loadManifest(
  basePath: string,
  fsOps: FileSystemOps
): Promise<BackupMeta[]> {
  const manifestPath = join(basePath, MANIFEST_FILE);
  if (!(await fsOps.exists(manifestPath))) {
    return [];
  }
  const data = await fsOps.readFile(manifestPath);
  return JSON.parse(new TextDecoder().decode(data));
}

async function saveManifest(
  basePath: string,
  backups: BackupMeta[],
  fsOps: FileSystemOps
): Promise<void> {
  const manifestPath = join(basePath, MANIFEST_FILE);
  await fsOps.writeFile(manifestPath, JSON.stringify(backups, null, 2));
}

function computeChecksum(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function createBackup(
  config: BackupConfig,
  options: { type?: "manual" | "scheduled"; description?: string } = {},
  fsOps: FileSystemOps = defaultFileSystemOps,
  dumpOps: DatabaseDumpOps = defaultDatabaseDumpOps
): Promise<BackupResult> {
  const { basePath, dbPath } = config;
  const type = options.type || "manual";
  const id = generateId();
  const timestamp = new Date().toISOString();
  const filename = `backup-${id}.db`;

  try {
    // Ensure backup directory exists
    await fsOps.mkdir(basePath, { recursive: true });

    const backupFilePath = join(basePath, filename);

    if (dbPath) {
      // Dump the SQLite database
      await dumpOps.dumpSqlite(dbPath, backupFilePath);
    } else {
      // Create an empty backup placeholder
      await fsOps.writeFile(backupFilePath, new Uint8Array(0));
    }

    // Read the backup file to compute checksum and size
    const data = await fsOps.readFile(backupFilePath);
    const checksum = computeChecksum(data);
    const size = data.length;

    const backup: BackupMeta = {
      id,
      type,
      timestamp,
      size,
      checksum,
      filename,
      description: options.description,
    };

    // Update manifest
    const backups = await loadManifest(basePath, fsOps);
    backups.push(backup);
    await saveManifest(basePath, backups, fsOps);

    return { success: true, backup };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Backup creation failed",
    };
  }
}

export async function listBackups(
  config: BackupConfig,
  fsOps: FileSystemOps = defaultFileSystemOps
): Promise<BackupMeta[]> {
  try {
    const backups = await loadManifest(config.basePath, fsOps);
    return backups.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch {
    return [];
  }
}

export async function getBackup(
  config: BackupConfig,
  backupId: string,
  fsOps: FileSystemOps = defaultFileSystemOps
): Promise<BackupMeta | null> {
  const backups = await loadManifest(config.basePath, fsOps);
  return backups.find((b) => b.id === backupId) || null;
}

export async function restoreBackup(
  config: BackupConfig,
  backupId: string,
  fsOps: FileSystemOps = defaultFileSystemOps,
  dumpOps: DatabaseDumpOps = defaultDatabaseDumpOps
): Promise<RestoreResult> {
  const backups = await loadManifest(config.basePath, fsOps);
  const backup = backups.find((b) => b.id === backupId);

  if (!backup) {
    return { success: false, error: "Backup not found" };
  }

  const backupFilePath = join(config.basePath, backup.filename);

  if (!(await fsOps.exists(backupFilePath))) {
    return { success: false, error: "Backup file not found on disk" };
  }

  try {
    // Verify checksum before restoring
    const data = await fsOps.readFile(backupFilePath);
    const checksum = computeChecksum(data);

    if (checksum !== backup.checksum) {
      return { success: false, error: "Backup checksum mismatch — file may be corrupted" };
    }

    if (config.dbPath) {
      await dumpOps.restoreSqlite(backupFilePath, config.dbPath);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Restore failed" };
  }
}

export async function deleteBackup(
  config: BackupConfig,
  backupId: string,
  fsOps: FileSystemOps = defaultFileSystemOps
): Promise<{ success: boolean; error?: string }> {
  const backups = await loadManifest(config.basePath, fsOps);
  const backup = backups.find((b) => b.id === backupId);

  if (!backup) {
    return { success: false, error: "Backup not found" };
  }

  const backupFilePath = join(config.basePath, backup.filename);

  try {
    if (await fsOps.exists(backupFilePath)) {
      await fsOps.unlink(backupFilePath);
    }

    const remaining = backups.filter((b) => b.id !== backupId);
    await saveManifest(config.basePath, remaining, fsOps);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Delete failed" };
  }
}

export async function rotateBackups(
  config: BackupConfig,
  fsOps: FileSystemOps = defaultFileSystemOps
): Promise<{ deleted: number }> {
  const backups = await loadManifest(config.basePath, fsOps);

  if (backups.length === 0) {
    return { deleted: 0 };
  }

  // Sort by timestamp descending
  const sorted = [...backups].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const now = new Date();
  const oneDayMs = 86400000;
  const oneWeekMs = 7 * oneDayMs;

  const keep = new Set<string>();
  let dailyCount = 0;
  let weeklyCount = 0;

  for (const backup of sorted) {
    const age = now.getTime() - new Date(backup.timestamp).getTime();

    if (age < oneDayMs) {
      // Today's backups — always keep
      keep.add(backup.id);
    } else if (age < oneWeekMs && dailyCount < config.keepDaily) {
      // Within a week — keep up to keepDaily
      keep.add(backup.id);
      dailyCount++;
    } else if (age < 30 * oneDayMs && weeklyCount < config.keepWeekly) {
      // Within a month — keep up to keepWeekly
      keep.add(backup.id);
      weeklyCount++;
    }
    // Older than a month — will be deleted
  }

  const toDelete = sorted.filter((b) => !keep.has(b.id));
  let deleted = 0;

  for (const backup of toDelete) {
    const filePath = join(config.basePath, backup.filename);
    try {
      if (await fsOps.exists(filePath)) {
        await fsOps.unlink(filePath);
      }
      deleted++;
    } catch {
      // Best effort cleanup
    }
  }

  const remaining = sorted.filter((b) => keep.has(b.id));
  await saveManifest(config.basePath, remaining, fsOps);

  return { deleted };
}

// ─── Error Class ────────────────────────────────────────────────────────────

export class BackupError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "BackupError";
  }
}
