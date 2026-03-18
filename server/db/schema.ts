import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "developer", "viewer"] })
    .notNull()
    .default("viewer"),
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Sessions ────────────────────────────────────────────────────────────────

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_sessions_token").on(table.token)]
);

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Apps ────────────────────────────────────────────────────────────────────

export const apps = sqliteTable("apps", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  repoUrl: text("repo_url").notNull(),
  branch: text("branch").notNull().default("main"),
  buildCommand: text("build_command"),
  startCommand: text("start_command"),
  runtime: text("runtime"),
  dockerfilePath: text("dockerfile_path"),
  port: integer("port"),
  status: text("status", {
    enum: ["created", "building", "running", "stopped", "failed"],
  })
    .notNull()
    .default("created"),
  deployMode: text("deploy_mode", { enum: ["docker", "pm2"] })
    .notNull()
    .default("docker"),
  containerId: text("container_id"),
  currentDeploymentId: text("current_deployment_id"),
  autoDeployEnabled: integer("auto_deploy_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  webhookSecret: text("webhook_secret"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── App Env Vars ────────────────────────────────────────────────────────────

export const appEnvVars = sqliteTable(
  "app_env_vars",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_env_vars_app_id").on(table.appId)]
);

// ─── Deployments ─────────────────────────────────────────────────────────────

export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    appId: text("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    commitHash: text("commit_hash"),
    commitMessage: text("commit_message"),
    branch: text("branch"),
    status: text("status", {
      enum: ["pending", "building", "deploying", "running", "failed", "rolled_back"],
    })
      .notNull()
      .default("pending"),
    buildLog: text("build_log"),
    imageId: text("image_id"),
    containerId: text("container_id"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_deployments_app_id").on(table.appId)]
);

// ─── Domains ─────────────────────────────────────────────────────────────────

export const domains = sqliteTable("domains", {
  id: text("id").primaryKey(),
  appId: text("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  domain: text("domain").notNull().unique(),
  status: text("status", { enum: ["pending", "verified", "failed"] })
    .notNull()
    .default("pending"),
  sslEnabled: integer("ssl_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Databases ───────────────────────────────────────────────────────────────

export const databases = sqliteTable("databases", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type", { enum: ["mysql", "postgresql"] }).notNull(),
  dbName: text("db_name").notNull(),
  username: text("username").notNull(),
  encryptedPassword: text("encrypted_password").notNull(),
  host: text("host").notNull().default("localhost"),
  port: integer("port").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Storage Buckets ─────────────────────────────────────────────────────────

export const storageBuckets = sqliteTable("storage_buckets", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  isPublic: integer("is_public", { mode: "boolean" }).notNull().default(false),
  maxSizeBytes: integer("max_size_bytes"),
  currentSizeBytes: integer("current_size_bytes").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Storage Files ───────────────────────────────────────────────────────────

export const storageFiles = sqliteTable(
  "storage_files",
  {
    id: text("id").primaryKey(),
    bucketId: text("bucket_id")
      .notNull()
      .references(() => storageBuckets.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    mimeType: text("mime_type"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_storage_files_bucket").on(table.bucketId)]
);

// ─── Cron Jobs ───────────────────────────────────────────────────────────────

export const cronJobs = sqliteTable("cron_jobs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  schedule: text("schedule").notNull(),
  command: text("command").notNull(),
  type: text("type", { enum: ["command", "http"] }).notNull().default("command"),
  httpUrl: text("http_url"),
  httpMethod: text("http_method"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  lastStatus: text("last_status"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Cron Executions ─────────────────────────────────────────────────────────

export const cronExecutions = sqliteTable(
  "cron_executions",
  {
    id: text("id").primaryKey(),
    cronJobId: text("cron_job_id")
      .notNull()
      .references(() => cronJobs.id, { onDelete: "cascade" }),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    exitCode: integer("exit_code"),
    stdout: text("stdout"),
    stderr: text("stderr"),
    status: text("status", { enum: ["running", "success", "failed"] })
      .notNull()
      .default("running"),
  },
  (table) => [index("idx_cron_exec_job").on(table.cronJobId)]
);

// ─── Metrics ─────────────────────────────────────────────────────────────────

export const metrics = sqliteTable(
  "metrics",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["server", "app"] }).notNull(),
    appId: text("app_id"),
    cpuPercent: integer("cpu_percent"),
    memoryUsedMb: integer("memory_used_mb"),
    memoryTotalMb: integer("memory_total_mb"),
    diskUsedGb: integer("disk_used_gb"),
    diskTotalGb: integer("disk_total_gb"),
    networkRxBytes: integer("network_rx_bytes"),
    networkTxBytes: integer("network_tx_bytes"),
    requestCount: integer("request_count"),
    timestamp: text("timestamp")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("idx_metrics_type_time").on(table.type, table.timestamp),
    index("idx_metrics_app_time").on(table.appId, table.timestamp),
  ]
);

// ─── Audit Log ───────────────────────────────────────────────────────────────

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
    details: text("details"), // JSON string
    ipAddress: text("ip_address"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("idx_audit_created").on(table.createdAt)]
);

// ─── Notifications ──────────────────────────────────────────────────────────

export const notificationChannels = sqliteTable("notification_channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["slack", "discord", "email"] }).notNull(),
  config: text("config").notNull(), // JSON string with webhook URL or SMTP config
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

// ─── Health Checks ──────────────────────────────────────────────────────────

export const healthChecks = sqliteTable("health_checks", {
  id: text("id").primaryKey(),
  appId: text("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().default("/"),
  intervalSeconds: integer("interval_seconds").notNull().default(30),
  timeoutSeconds: integer("timeout_seconds").notNull().default(5),
  maxFailures: integer("max_failures").notNull().default(3),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastCheckedAt: text("last_checked_at"),
  lastStatus: text("last_status"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
