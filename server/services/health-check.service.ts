// ─── Health Check Service ───────────────────────────────────────────────────

import { eq } from "drizzle-orm";
import { type AppDatabase } from "../db";
import { healthChecks, apps } from "../db/schema";
import { generateId } from "./crypto.service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HealthCheckConfig {
  appId: string;
  endpoint?: string;
  intervalSeconds?: number;
  timeoutSeconds?: number;
  maxFailures?: number;
  enabled?: boolean;
}

export interface HealthCheck {
  id: string;
  appId: string;
  endpoint: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  maxFailures: number;
  enabled: boolean;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastStatus: string | null;
  createdAt: string;
}

export interface HealthCheckResult {
  checkId: string;
  appId: string;
  status: "healthy" | "unhealthy";
  statusCode?: number;
  responseTimeMs: number;
  error?: string;
  timestamp: string;
  consecutiveFailures: number;
  autoRestarted: boolean;
}

export interface HealthCheckHistoryEntry {
  status: "healthy" | "unhealthy";
  statusCode?: number;
  responseTimeMs: number;
  error?: string;
  timestamp: string;
}

// ─── Mockable Interfaces ────────────────────────────────────────────────────

export interface HttpChecker {
  check(
    url: string,
    timeoutMs: number
  ): Promise<{ status: number; responseTimeMs: number }>;
}

export interface AppRestarter {
  restart(appId: string): Promise<void>;
}

// ─── Default Implementations ────────────────────────────────────────────────

export const defaultHttpChecker: HttpChecker = {
  async check(url, timeoutMs) {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      const responseTimeMs = Date.now() - start;
      return { status: response.status, responseTimeMs };
    } finally {
      clearTimeout(timer);
    }
  },
};

export const defaultAppRestarter: AppRestarter = {
  async restart(_appId) {
    // In production, integrate with deploy/docker service
    throw new HealthCheckError("Auto-restart not configured", 501);
  },
};

// ─── In-Memory History ──────────────────────────────────────────────────────

const historyStore = new Map<string, HealthCheckHistoryEntry[]>();
const MAX_HISTORY = 100;

function addHistoryEntry(
  checkId: string,
  entry: HealthCheckHistoryEntry
): void {
  if (!historyStore.has(checkId)) {
    historyStore.set(checkId, []);
  }
  const history = historyStore.get(checkId)!;
  history.push(entry);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

// For testing
export function _clearHistory(): void {
  historyStore.clear();
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createHealthCheck(
  db: AppDatabase,
  input: HealthCheckConfig
): Promise<HealthCheck> {
  if (!input.appId) {
    throw new HealthCheckError("App ID is required", 400);
  }

  // Verify app exists
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, input.appId),
  });

  if (!app) {
    throw new HealthCheckError("App not found", 404);
  }

  // Check for existing health check for this app
  const existing = await db.query.healthChecks.findFirst({
    where: eq(healthChecks.appId, input.appId),
  });

  if (existing) {
    throw new HealthCheckError(
      "Health check already exists for this app. Update or delete it first.",
      409
    );
  }

  const id = generateId();
  const now = new Date().toISOString();

  const endpoint = input.endpoint || "/";
  const intervalSeconds = input.intervalSeconds || 30;
  const timeoutSeconds = input.timeoutSeconds || 5;
  const maxFailures = input.maxFailures || 3;
  const enabled = input.enabled !== false;

  await db.insert(healthChecks).values({
    id,
    appId: input.appId,
    endpoint,
    intervalSeconds,
    timeoutSeconds,
    maxFailures,
    enabled,
    consecutiveFailures: 0,
    lastCheckedAt: null,
    lastStatus: null,
    createdAt: now,
  });

  return {
    id,
    appId: input.appId,
    endpoint,
    intervalSeconds,
    timeoutSeconds,
    maxFailures,
    enabled,
    consecutiveFailures: 0,
    lastCheckedAt: null,
    lastStatus: null,
    createdAt: now,
  };
}

export async function getHealthCheck(
  db: AppDatabase,
  id: string
): Promise<HealthCheck | null> {
  const row = await db.query.healthChecks.findFirst({
    where: eq(healthChecks.id, id),
  });

  if (!row) return null;

  return {
    id: row.id,
    appId: row.appId,
    endpoint: row.endpoint,
    intervalSeconds: row.intervalSeconds,
    timeoutSeconds: row.timeoutSeconds,
    maxFailures: row.maxFailures,
    enabled: row.enabled,
    consecutiveFailures: row.consecutiveFailures,
    lastCheckedAt: row.lastCheckedAt,
    lastStatus: row.lastStatus,
    createdAt: row.createdAt,
  };
}

export async function getHealthCheckByAppId(
  db: AppDatabase,
  appId: string
): Promise<HealthCheck | null> {
  const row = await db.query.healthChecks.findFirst({
    where: eq(healthChecks.appId, appId),
  });

  if (!row) return null;

  return {
    id: row.id,
    appId: row.appId,
    endpoint: row.endpoint,
    intervalSeconds: row.intervalSeconds,
    timeoutSeconds: row.timeoutSeconds,
    maxFailures: row.maxFailures,
    enabled: row.enabled,
    consecutiveFailures: row.consecutiveFailures,
    lastCheckedAt: row.lastCheckedAt,
    lastStatus: row.lastStatus,
    createdAt: row.createdAt,
  };
}

export async function updateHealthCheck(
  db: AppDatabase,
  id: string,
  updates: Partial<
    Pick<
      HealthCheckConfig,
      "endpoint" | "intervalSeconds" | "timeoutSeconds" | "maxFailures" | "enabled"
    >
  >
): Promise<HealthCheck | null> {
  const existing = await db.query.healthChecks.findFirst({
    where: eq(healthChecks.id, id),
  });

  if (!existing) {
    throw new HealthCheckError("Health check not found", 404);
  }

  const updateData: Record<string, unknown> = {};

  if (updates.endpoint !== undefined) updateData.endpoint = updates.endpoint;
  if (updates.intervalSeconds !== undefined)
    updateData.intervalSeconds = updates.intervalSeconds;
  if (updates.timeoutSeconds !== undefined)
    updateData.timeoutSeconds = updates.timeoutSeconds;
  if (updates.maxFailures !== undefined)
    updateData.maxFailures = updates.maxFailures;
  if (updates.enabled !== undefined) updateData.enabled = updates.enabled;

  if (Object.keys(updateData).length > 0) {
    await db
      .update(healthChecks)
      .set(updateData)
      .where(eq(healthChecks.id, id));
  }

  return getHealthCheck(db, id);
}

export async function deleteHealthCheck(
  db: AppDatabase,
  id: string
): Promise<boolean> {
  const existing = await db.query.healthChecks.findFirst({
    where: eq(healthChecks.id, id),
  });

  if (!existing) {
    throw new HealthCheckError("Health check not found", 404);
  }

  await db.delete(healthChecks).where(eq(healthChecks.id, id));
  historyStore.delete(id);

  return true;
}

// ─── Run Check ──────────────────────────────────────────────────────────────

export async function runHealthCheck(
  db: AppDatabase,
  checkId: string,
  httpChecker: HttpChecker = defaultHttpChecker,
  restarter: AppRestarter = defaultAppRestarter
): Promise<HealthCheckResult> {
  const check = await getHealthCheck(db, checkId);

  if (!check) {
    throw new HealthCheckError("Health check not found", 404);
  }

  if (!check.enabled) {
    throw new HealthCheckError("Health check is disabled", 400);
  }

  // Get app to find port
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, check.appId),
  });

  if (!app) {
    throw new HealthCheckError("App not found", 404);
  }

  const port = app.port || 3000;
  const url = `http://localhost:${port}${check.endpoint}`;
  const timeoutMs = check.timeoutSeconds * 1000;
  const now = new Date().toISOString();

  let status: "healthy" | "unhealthy";
  let statusCode: number | undefined;
  let responseTimeMs = 0;
  let error: string | undefined;
  let autoRestarted = false;

  try {
    const result = await httpChecker.check(url, timeoutMs);
    statusCode = result.status;
    responseTimeMs = result.responseTimeMs;

    if (result.status >= 200 && result.status < 400) {
      status = "healthy";
    } else {
      status = "unhealthy";
      error = `HTTP ${result.status}`;
    }
  } catch (err: any) {
    status = "unhealthy";
    responseTimeMs = check.timeoutSeconds * 1000;
    error = err.message || "Check failed";
  }

  // Update consecutive failures
  let consecutiveFailures = check.consecutiveFailures;

  if (status === "healthy") {
    consecutiveFailures = 0;
  } else {
    consecutiveFailures++;
  }

  // Update the health check record
  await db
    .update(healthChecks)
    .set({
      consecutiveFailures,
      lastCheckedAt: now,
      lastStatus: status,
    })
    .where(eq(healthChecks.id, checkId));

  // Auto-restart if threshold reached
  if (
    status === "unhealthy" &&
    consecutiveFailures >= check.maxFailures
  ) {
    try {
      await restarter.restart(check.appId);
      autoRestarted = true;

      // Reset consecutive failures after restart
      await db
        .update(healthChecks)
        .set({ consecutiveFailures: 0 })
        .where(eq(healthChecks.id, checkId));
      consecutiveFailures = 0;
    } catch {
      // Auto-restart failed — keep tracking failures
    }
  }

  // Record history
  addHistoryEntry(checkId, {
    status,
    statusCode,
    responseTimeMs,
    error,
    timestamp: now,
  });

  return {
    checkId,
    appId: check.appId,
    status,
    statusCode,
    responseTimeMs,
    error,
    timestamp: now,
    consecutiveFailures,
    autoRestarted,
  };
}

// ─── History ────────────────────────────────────────────────────────────────

export function getHealthCheckHistory(
  checkId: string,
  limit: number = 50
): HealthCheckHistoryEntry[] {
  const history = historyStore.get(checkId) || [];
  return history.slice(-limit);
}

// ─── Error Class ────────────────────────────────────────────────────────────

export class HealthCheckError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "HealthCheckError";
  }
}
