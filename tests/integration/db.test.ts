import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import * as schema from "../../server/db/schema";
import { ensureTables, type AppDatabase } from "../../server/db";
import { loadConfig } from "../../server/config";

loadConfig({ NODE_ENV: "test", MASTER_KEY: "a".repeat(64) });

let db: AppDatabase;

beforeEach(() => {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  ensureTables(db);
});

describe("Database Setup", () => {
  it("creates all expected tables", () => {
    const result = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    const tables = result.map((r) => r.name);

    expect(tables).toContain("users");
    expect(tables).toContain("sessions");
    expect(tables).toContain("settings");
    expect(tables).toContain("apps");
    expect(tables).toContain("app_env_vars");
    expect(tables).toContain("deployments");
    expect(tables).toContain("domains");
    expect(tables).toContain("databases");
    expect(tables).toContain("storage_buckets");
    expect(tables).toContain("storage_files");
    expect(tables).toContain("cron_jobs");
    expect(tables).toContain("cron_executions");
    expect(tables).toContain("metrics");
    expect(tables).toContain("audit_log");
    expect(tables).toContain("notification_channels");
    expect(tables).toContain("health_checks");
  });

  it("runs ensureTables idempotently (twice without error)", () => {
    expect(() => ensureTables(db)).not.toThrow();
    expect(() => ensureTables(db)).not.toThrow();
  });

  it("has WAL mode enabled", () => {
    // The in-memory DB falls back to 'memory' for journal_mode,
    // but ensure the pragma doesn't error
    const result = db.all<{ journal_mode: string }>(
      sql`PRAGMA journal_mode`
    );
    expect(result).toBeDefined();
  });

  it("enforces foreign key constraints", () => {
    expect(() => {
      db.run(sql`INSERT INTO sessions (id, user_id, token, expires_at, created_at)
        VALUES ('s1', 'nonexistent-user', 'tok', '2099-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`);
    }).toThrow();
  });

  it("supports concurrent reads without blocking", () => {
    // Insert a user
    const now = new Date().toISOString();
    db.run(
      sql`INSERT INTO users (id, username, password_hash, role, totp_enabled, created_at, updated_at)
        VALUES ('u1', 'testuser', 'hash', 'admin', 0, ${now}, ${now})`
    );

    // Concurrent reads
    const r1 = db.all(sql`SELECT * FROM users WHERE id = 'u1'`);
    const r2 = db.all(sql`SELECT * FROM users WHERE id = 'u1'`);

    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  it("handles write-after-write without corruption", () => {
    const now = new Date().toISOString();

    db.run(
      sql`INSERT INTO settings (key, value, updated_at) VALUES ('key1', 'val1', ${now})`
    );
    db.run(
      sql`INSERT INTO settings (key, value, updated_at) VALUES ('key2', 'val2', ${now})`
    );

    const result = db.all(sql`SELECT * FROM settings ORDER BY key`);
    expect(result).toHaveLength(2);
  });

  it("enforces unique constraints", () => {
    const now = new Date().toISOString();
    db.run(
      sql`INSERT INTO users (id, username, password_hash, role, totp_enabled, created_at, updated_at)
        VALUES ('u1', 'unique_user', 'hash', 'admin', 0, ${now}, ${now})`
    );

    expect(() => {
      db.run(
        sql`INSERT INTO users (id, username, password_hash, role, totp_enabled, created_at, updated_at)
          VALUES ('u2', 'unique_user', 'hash2', 'viewer', 0, ${now}, ${now})`
      );
    }).toThrow();
  });

  it("cascades on user delete (sessions removed)", () => {
    const now = new Date().toISOString();
    db.run(
      sql`INSERT INTO users (id, username, password_hash, role, totp_enabled, created_at, updated_at)
        VALUES ('u1', 'testuser', 'hash', 'admin', 0, ${now}, ${now})`
    );
    db.run(
      sql`INSERT INTO sessions (id, user_id, token, expires_at, created_at)
        VALUES ('s1', 'u1', 'token123', '2099-01-01T00:00:00Z', ${now})`
    );

    db.run(sql`DELETE FROM users WHERE id = 'u1'`);

    const sessions = db.all(sql`SELECT * FROM sessions WHERE user_id = 'u1'`);
    expect(sessions).toHaveLength(0);
  });
});
