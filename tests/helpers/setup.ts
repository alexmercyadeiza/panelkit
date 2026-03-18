import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../../server/db/schema";
import { ensureTables, setDb, type AppDatabase } from "../../server/db";
import { loadConfig } from "../../server/config";
import { _clearRateLimits } from "../../server/services/auth.service";
import { _clearRateLimitStore } from "../../server/middleware/rate-limit";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Initialize test config
loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: ":memory:",
  MASTER_KEY: "a".repeat(64),
  SESSION_TTL_SECONDS: 86400,
  RATE_LIMIT_MAX: 100,
  RATE_LIMIT_WINDOW_MS: 60000,
});

export function createTestDb(): AppDatabase {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  ensureTables(db);
  setDb(db);
  return db;
}

export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "panelkit-test-"));
}

export function cleanupTempDir(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function resetTestState() {
  _clearRateLimits();
  _clearRateLimitStore();
}
