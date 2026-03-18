// ─── Cron Job Management Service ─────────────────────────────────────────────

import { eq, desc } from "drizzle-orm";
import { type AppDatabase, getDb } from "../db";
import { cronJobs, cronExecutions } from "../db/schema";
import { generateId } from "./crypto.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CronJobType = "command" | "http";

export interface CronJobRecord {
  id: string;
  name: string;
  schedule: string;
  command: string;
  type: CronJobType;
  httpUrl: string | null;
  httpMethod: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
}

export interface CronExecutionRecord {
  id: string;
  cronJobId: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  status: "running" | "success" | "failed";
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Interface for crontab operations.
 * Allows tests to mock system crontab interactions.
 */
export interface CrontabExecutor {
  installJob(id: string, schedule: string, command: string): Promise<void>;
  removeJob(id: string): Promise<void>;
  listJobs(): Promise<string>;
}

/**
 * Interface for command execution.
 * Allows tests to mock actual command execution.
 */
export interface CommandExecutor {
  execute(command: string, timeout?: number): Promise<ExecutionResult>;
  executeHttp(url: string, method: string): Promise<ExecutionResult>;
}

// ─── Cron Expression Validation ──────────────────────────────────────────────

/**
 * Validate a cron expression (5-field format).
 * Fields: minute hour day-of-month month day-of-week
 */
export function validateCronExpression(expression: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = expression.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length !== 5) {
    return {
      valid: false,
      error: `Expected 5 fields (minute hour day month weekday), got ${parts.length}`,
    };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const fieldChecks: [string, string, number, number][] = [
    [minute, "minute", 0, 59],
    [hour, "hour", 0, 23],
    [dayOfMonth, "day of month", 1, 31],
    [month, "month", 1, 12],
    [dayOfWeek, "day of week", 0, 7],
  ];

  for (const [value, name, min, max] of fieldChecks) {
    const result = validateCronField(value, name, min, max);
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
}

function validateCronField(
  value: string,
  name: string,
  min: number,
  max: number
): { valid: boolean; error?: string } {
  // Wildcard
  if (value === "*") return { valid: true };

  // Step values: */n or n-m/s
  if (value.includes("/")) {
    const [range, step] = value.split("/");
    if (!step || isNaN(parseInt(step, 10)) || parseInt(step, 10) <= 0) {
      return { valid: false, error: `Invalid step value in ${name}: ${value}` };
    }
    if (range !== "*") {
      return validateCronField(range, name, min, max);
    }
    return { valid: true };
  }

  // Ranges: n-m
  if (value.includes("-")) {
    const [start, end] = value.split("-");
    const s = parseInt(start, 10);
    const e = parseInt(end, 10);
    if (isNaN(s) || isNaN(e) || s < min || e > max || s > e) {
      return { valid: false, error: `Invalid range in ${name}: ${value} (allowed: ${min}-${max})` };
    }
    return { valid: true };
  }

  // Lists: a,b,c
  if (value.includes(",")) {
    const items = value.split(",");
    for (const item of items) {
      const result = validateCronField(item, name, min, max);
      if (!result.valid) return result;
    }
    return { valid: true };
  }

  // Single value
  const num = parseInt(value, 10);
  if (isNaN(num) || num < min || num > max) {
    return {
      valid: false,
      error: `Invalid value for ${name}: ${value} (allowed: ${min}-${max})`,
    };
  }

  return { valid: true };
}

// ─── Dangerous Command Detection ─────────────────────────────────────────────

const DANGEROUS_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\/\s*$/, description: "Recursive delete of root filesystem" },
  { pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/, description: "Recursive delete of root filesystem" },
  { pattern: /rm\s+-rf\s+\/\s*$/, description: "Recursive delete of root filesystem" },
  { pattern: /rm\s+-fr\s+\/\s*$/, description: "Recursive delete of root filesystem" },
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, description: "Fork bomb detected" },
  { pattern: /mkfs\./, description: "Filesystem format command" },
  { pattern: /dd\s+.*of=\/dev\/[sh]d/, description: "Direct disk write" },
  { pattern: />\s*\/dev\/[sh]d/, description: "Direct disk write" },
  { pattern: /chmod\s+-R\s+777\s+\/\s*$/, description: "Recursive chmod on root" },
  { pattern: /chown\s+-R\s+.*\s+\/\s*$/, description: "Recursive chown on root" },
  { pattern: /wget\s+.*\|\s*sh/, description: "Remote code execution" },
  { pattern: /curl\s+.*\|\s*sh/, description: "Remote code execution" },
  { pattern: /curl\s+.*\|\s*bash/, description: "Remote code execution" },
  { pattern: /wget\s+.*\|\s*bash/, description: "Remote code execution" },
];

/**
 * Check if a command is potentially dangerous.
 * Returns null if safe, or a description of the danger.
 */
export function checkDangerousCommand(command: string): string | null {
  const trimmed = command.trim();

  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return description;
    }
  }

  return null;
}

// ─── Default Executors ───────────────────────────────────────────────────────

export const defaultCrontabExecutor: CrontabExecutor = {
  async installJob(id, schedule, command) {
    // Add a comment marker to identify PanelKit-managed jobs
    const marker = `# panelkit-cron:${id}`;
    const cronLine = `${schedule} ${command} ${marker}`;

    // Get current crontab, add new entry
    const proc = Bun.spawn(["bash", "-c", `(crontab -l 2>/dev/null; echo '${cronLine}') | crontab -`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new CronError(`Failed to install cron job: ${stderr}`, 500);
    }
  },

  async removeJob(id) {
    const marker = `panelkit-cron:${id}`;
    const proc = Bun.spawn(["bash", "-c", `crontab -l 2>/dev/null | grep -v '${marker}' | crontab -`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
  },

  async listJobs() {
    const proc = Bun.spawn(["crontab", "-l"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return await new Response(proc.stdout).text();
  },
};

export const defaultCommandExecutor: CommandExecutor = {
  async execute(command, timeout = 30000) {
    const proc = Bun.spawn(["bash", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timer = setTimeout(() => {
      proc.kill();
    }, timeout);

    const exitCode = await proc.exited;
    clearTimeout(timer);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return { exitCode, stdout, stderr };
  },

  async executeHttp(url, method) {
    try {
      const response = await fetch(url, { method });
      const body = await response.text();
      return {
        exitCode: response.ok ? 0 : 1,
        stdout: body,
        stderr: response.ok ? "" : `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (err) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: (err as Error).message,
      };
    }
  },
};

// ─── Service State ───────────────────────────────────────────────────────────

let _crontabExecutor: CrontabExecutor = defaultCrontabExecutor;
let _commandExecutor: CommandExecutor = defaultCommandExecutor;

export function setCrontabExecutor(executor: CrontabExecutor): void {
  _crontabExecutor = executor;
}

export function resetCrontabExecutor(): void {
  _crontabExecutor = defaultCrontabExecutor;
}

export function setCommandExecutor(executor: CommandExecutor): void {
  _commandExecutor = executor;
}

export function resetCommandExecutor(): void {
  _commandExecutor = defaultCommandExecutor;
}

// ─── CRUD Operations ────────────────────────────────────────────────────────

/**
 * Create a new cron job.
 */
export async function createCronJob(
  data: {
    name: string;
    schedule: string;
    command: string;
    type?: CronJobType;
    httpUrl?: string;
    httpMethod?: string;
    enabled?: boolean;
  },
  db?: AppDatabase
): Promise<CronJobRecord> {
  const database = db || getDb();

  // Validate schedule
  const scheduleResult = validateCronExpression(data.schedule);
  if (!scheduleResult.valid) {
    throw new CronError(`Invalid cron expression: ${scheduleResult.error}`, 400);
  }

  // Check for dangerous commands
  if (data.type !== "http") {
    const danger = checkDangerousCommand(data.command);
    if (danger) {
      throw new CronError(`Dangerous command blocked: ${danger}`, 400);
    }
  }

  // Validate HTTP type
  if (data.type === "http") {
    if (!data.httpUrl) {
      throw new CronError("HTTP URL is required for HTTP type cron jobs", 400);
    }
    try {
      new URL(data.httpUrl);
    } catch {
      throw new CronError("Invalid HTTP URL", 400);
    }
  }

  const id = generateId();
  const now = new Date().toISOString();
  const enabled = data.enabled ?? true;

  await database.insert(cronJobs).values({
    id,
    name: data.name,
    schedule: data.schedule,
    command: data.command,
    type: data.type || "command",
    httpUrl: data.httpUrl || null,
    httpMethod: data.httpMethod || null,
    enabled,
    createdAt: now,
  });

  // Install into system crontab if enabled
  if (enabled && data.type !== "http") {
    try {
      await _crontabExecutor.installJob(id, data.schedule, data.command);
    } catch {
      // Best effort — job is tracked in DB regardless
    }
  }

  return {
    id,
    name: data.name,
    schedule: data.schedule,
    command: data.command,
    type: (data.type || "command") as CronJobType,
    httpUrl: data.httpUrl || null,
    httpMethod: data.httpMethod || null,
    enabled,
    lastRunAt: null,
    lastStatus: null,
    createdAt: now,
  };
}

/**
 * List all cron jobs.
 */
export async function listCronJobs(
  db?: AppDatabase
): Promise<CronJobRecord[]> {
  const database = db || getDb();

  const rows = await database
    .select()
    .from(cronJobs)
    .orderBy(desc(cronJobs.createdAt));

  return rows as CronJobRecord[];
}

/**
 * Get a single cron job by ID.
 */
export async function getCronJob(
  id: string,
  db?: AppDatabase
): Promise<CronJobRecord | null> {
  const database = db || getDb();

  const row = await database.query.cronJobs.findFirst({
    where: eq(cronJobs.id, id),
  });

  return (row as CronJobRecord) || null;
}

/**
 * Update a cron job.
 */
export async function updateCronJob(
  id: string,
  data: {
    name?: string;
    schedule?: string;
    command?: string;
    type?: CronJobType;
    httpUrl?: string;
    httpMethod?: string;
    enabled?: boolean;
  },
  db?: AppDatabase
): Promise<CronJobRecord> {
  const database = db || getDb();

  const existing = await database.query.cronJobs.findFirst({
    where: eq(cronJobs.id, id),
  });

  if (!existing) {
    throw new CronError("Cron job not found", 404);
  }

  // Validate schedule if provided
  if (data.schedule) {
    const scheduleResult = validateCronExpression(data.schedule);
    if (!scheduleResult.valid) {
      throw new CronError(`Invalid cron expression: ${scheduleResult.error}`, 400);
    }
  }

  // Check for dangerous commands if command changed
  if (data.command && (data.type || existing.type) !== "http") {
    const danger = checkDangerousCommand(data.command);
    if (danger) {
      throw new CronError(`Dangerous command blocked: ${danger}`, 400);
    }
  }

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.schedule !== undefined) updates.schedule = data.schedule;
  if (data.command !== undefined) updates.command = data.command;
  if (data.type !== undefined) updates.type = data.type;
  if (data.httpUrl !== undefined) updates.httpUrl = data.httpUrl;
  if (data.httpMethod !== undefined) updates.httpMethod = data.httpMethod;
  if (data.enabled !== undefined) updates.enabled = data.enabled;

  await database.update(cronJobs).set(updates).where(eq(cronJobs.id, id));

  // Update crontab
  const newEnabled = data.enabled ?? existing.enabled;
  const newType = data.type || existing.type;
  const newSchedule = data.schedule || existing.schedule;
  const newCommand = data.command || existing.command;

  try {
    // Remove old entry
    await _crontabExecutor.removeJob(id);

    // Re-install if enabled and command type
    if (newEnabled && newType !== "http") {
      await _crontabExecutor.installJob(id, newSchedule, newCommand);
    }
  } catch {
    // Best effort
  }

  const updated = await database.query.cronJobs.findFirst({
    where: eq(cronJobs.id, id),
  });

  return updated as CronJobRecord;
}

/**
 * Delete a cron job.
 */
export async function deleteCronJob(
  id: string,
  db?: AppDatabase
): Promise<void> {
  const database = db || getDb();

  const existing = await database.query.cronJobs.findFirst({
    where: eq(cronJobs.id, id),
  });

  if (!existing) {
    throw new CronError("Cron job not found", 404);
  }

  // Remove from system crontab
  try {
    await _crontabExecutor.removeJob(id);
  } catch {
    // Best effort
  }

  // Delete from database (cascades to executions)
  await database.delete(cronJobs).where(eq(cronJobs.id, id));
}

/**
 * Enable or disable a cron job.
 */
export async function toggleCronJob(
  id: string,
  enabled: boolean,
  db?: AppDatabase
): Promise<CronJobRecord> {
  return updateCronJob(id, { enabled }, db);
}

// ─── Execution ───────────────────────────────────────────────────────────────

/**
 * Execute a cron job immediately ("Run Now").
 */
export async function runCronJob(
  id: string,
  db?: AppDatabase
): Promise<CronExecutionRecord> {
  const database = db || getDb();

  const job = await database.query.cronJobs.findFirst({
    where: eq(cronJobs.id, id),
  });

  if (!job) {
    throw new CronError("Cron job not found", 404);
  }

  // Create execution record
  const execId = generateId();
  const startedAt = new Date().toISOString();

  await database.insert(cronExecutions).values({
    id: execId,
    cronJobId: id,
    startedAt,
    status: "running",
  });

  // Execute the command
  let result: ExecutionResult;

  try {
    if (job.type === "http") {
      result = await _commandExecutor.executeHttp(
        job.httpUrl!,
        job.httpMethod || "GET"
      );
    } else {
      result = await _commandExecutor.execute(job.command);
    }
  } catch (err) {
    result = {
      exitCode: 1,
      stdout: "",
      stderr: (err as Error).message,
    };
  }

  // Update execution record
  const finishedAt = new Date().toISOString();
  const status = result.exitCode === 0 ? "success" : "failed";

  await database
    .update(cronExecutions)
    .set({
      finishedAt,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      status,
    })
    .where(eq(cronExecutions.id, execId));

  // Update job's last run info
  await database
    .update(cronJobs)
    .set({
      lastRunAt: finishedAt,
      lastStatus: status,
    })
    .where(eq(cronJobs.id, id));

  return {
    id: execId,
    cronJobId: id,
    startedAt,
    finishedAt,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    status: status as "success" | "failed",
  };
}

/**
 * Get execution history for a cron job.
 */
export async function getCronHistory(
  cronJobId: string,
  limit: number = 20,
  offset: number = 0,
  db?: AppDatabase
): Promise<CronExecutionRecord[]> {
  const database = db || getDb();

  // Verify the job exists
  const job = await database.query.cronJobs.findFirst({
    where: eq(cronJobs.id, cronJobId),
  });

  if (!job) {
    throw new CronError("Cron job not found", 404);
  }

  const rows = await database
    .select()
    .from(cronExecutions)
    .where(eq(cronExecutions.cronJobId, cronJobId))
    .orderBy(desc(cronExecutions.startedAt))
    .limit(limit)
    .offset(offset);

  return rows as CronExecutionRecord[];
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class CronError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "CronError";
  }
}
