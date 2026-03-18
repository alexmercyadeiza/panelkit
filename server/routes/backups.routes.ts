// ─── Backup Routes ──────────────────────────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { getConfig } from "../config";
import { join } from "path";
import {
  createBackup,
  listBackups,
  getBackup,
  restoreBackup,
  deleteBackup,
  rotateBackups,
  type BackupConfig,
  BackupError,
} from "../services/backup.service";

const backupsRoutes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createBackupSchema = z.object({
  description: z.string().optional(),
  type: z.enum(["manual", "scheduled"]).default("manual"),
});

// ─── Helper ─────────────────────────────────────────────────────────────────

function getBackupConfig(): BackupConfig {
  const config = getConfig();
  return {
    basePath: join(config.DATA_DIR, "backups"),
    keepDaily: 7,
    keepWeekly: 4,
    dbPath: config.DATABASE_URL,
  };
}

// ─── Auth middleware for all routes ──────────────────────────────────────────

backupsRoutes.use("*", authMiddleware);

// ─── POST /api/backups — Create a backup ────────────────────────────────────

backupsRoutes.post("/", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  let parsed = { type: "manual" as const, description: undefined as string | undefined };
  try {
    const body = await c.req.json();
    parsed = createBackupSchema.parse(body);
  } catch (e: any) {
    // If body parse fails for non-zod reasons, use defaults
    if (e.name === "ZodError") throw e;
  }

  const backupConfig = getBackupConfig();
  const result = await createBackup(backupConfig, {
    type: parsed.type,
    description: parsed.description,
  });

  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }

  return c.json({ backup: result.backup }, 201);
});

// ─── GET /api/backups — List all backups ────────────────────────────────────

backupsRoutes.get("/", async (c) => {
  const backupConfig = getBackupConfig();
  const backups = await listBackups(backupConfig);
  return c.json({ backups });
});

// ─── POST /api/backups/:id/restore — Restore from backup ───────────────────

backupsRoutes.post("/:id/restore", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const id = c.req.param("id");
  const backupConfig = getBackupConfig();

  const backup = await getBackup(backupConfig, id);
  if (!backup) {
    return c.json({ error: "Backup not found" }, 404);
  }

  const result = await restoreBackup(backupConfig, id);

  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }

  return c.json({ success: true, message: "Backup restored successfully" });
});

// ─── DELETE /api/backups/:id — Delete a backup ─────────────────────────────

backupsRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const id = c.req.param("id");
  const backupConfig = getBackupConfig();

  const result = await deleteBackup(backupConfig, id);

  if (!result.success) {
    return c.json({ error: result.error }, 404);
  }

  return c.json({ success: true });
});

// ─── POST /api/backups/rotate — Trigger backup rotation ────────────────────

backupsRoutes.post("/rotate", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const backupConfig = getBackupConfig();
  const result = await rotateBackups(backupConfig);

  return c.json({ success: true, deleted: result.deleted });
});

export { backupsRoutes };
