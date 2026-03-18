import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";
import { getConfig } from "../config";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { sql } from "drizzle-orm";
import { join } from "path";

let _db: ReturnType<typeof createDatabase> | null = null;

export function createDatabase(dbPath?: string) {
  const path = dbPath || getConfig().DATABASE_URL;
  const sqlite = new Database(path);

  // Enable WAL mode for better concurrent read performance
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });
  return db;
}

export type AppDatabase = ReturnType<typeof createDatabase>;

export function getDb(): AppDatabase {
  if (!_db) {
    _db = createDatabase();
  }
  return _db;
}

export function setDb(db: AppDatabase) {
  _db = db;
}

export function runMigrations(db: AppDatabase) {
  migrate(db, {
    migrationsFolder: join(import.meta.dir, "migrations"),
  });
}

export function ensureTables(db: AppDatabase) {
  // Create tables directly from schema for fresh installs
  db.run(sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  )`);

  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`
  );

  db.run(sql`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    repo_url TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT 'main',
    build_command TEXT,
    start_command TEXT,
    runtime TEXT,
    dockerfile_path TEXT,
    port INTEGER,
    status TEXT NOT NULL DEFAULT 'created',
    deploy_mode TEXT NOT NULL DEFAULT 'docker',
    container_id TEXT,
    current_deployment_id TEXT,
    auto_deploy_enabled INTEGER NOT NULL DEFAULT 1,
    webhook_secret TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS app_env_vars (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    encrypted_value TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_env_vars_app_id ON app_env_vars(app_id)`
  );

  db.run(sql`CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    commit_hash TEXT,
    commit_message TEXT,
    branch TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    build_log TEXT,
    image_id TEXT,
    container_id TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL
  )`);

  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_deployments_app_id ON deployments(app_id)`
  );

  db.run(sql`CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    domain TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    ssl_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS databases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    db_name TEXT NOT NULL,
    username TEXT NOT NULL,
    encrypted_password TEXT NOT NULL,
    host TEXT NOT NULL DEFAULT 'localhost',
    port INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS storage_buckets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    is_public INTEGER NOT NULL DEFAULT 0,
    max_size_bytes INTEGER,
    current_size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS storage_files (
    id TEXT PRIMARY KEY,
    bucket_id TEXT NOT NULL REFERENCES storage_buckets(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mime_type TEXT,
    created_at TEXT NOT NULL
  )`);

  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_storage_files_bucket ON storage_files(bucket_id)`
  );

  db.run(sql`CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    command TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'command',
    http_url TEXT,
    http_method TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    last_status TEXT,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS cron_executions (
    id TEXT PRIMARY KEY,
    cron_job_id TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    exit_code INTEGER,
    stdout TEXT,
    stderr TEXT,
    status TEXT NOT NULL DEFAULT 'running'
  )`);

  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_cron_exec_job ON cron_executions(cron_job_id)`
  );

  db.run(sql`CREATE TABLE IF NOT EXISTS metrics (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    app_id TEXT,
    cpu_percent INTEGER,
    memory_used_mb INTEGER,
    memory_total_mb INTEGER,
    disk_used_gb INTEGER,
    disk_total_gb INTEGER,
    network_rx_bytes INTEGER,
    network_tx_bytes INTEGER,
    request_count INTEGER,
    timestamp TEXT NOT NULL
  )`);

  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_metrics_type_time ON metrics(type, timestamp)`
  );
  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_metrics_app_time ON metrics(app_id, timestamp)`
  );

  db.run(sql`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    resource_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
  )`);

  db.run(
    sql`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`
  );

  db.run(sql`CREATE TABLE IF NOT EXISTS notification_channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS health_checks (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL DEFAULT '/',
    interval_seconds INTEGER NOT NULL DEFAULT 30,
    timeout_seconds INTEGER NOT NULL DEFAULT 5,
    max_failures INTEGER NOT NULL DEFAULT 3,
    enabled INTEGER NOT NULL DEFAULT 1,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_checked_at TEXT,
    last_status TEXT,
    created_at TEXT NOT NULL
  )`);
}

export { schema };
