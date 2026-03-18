// ─── Audit Logging Service ───────────────────────────────────────────────────

import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { getDb, type AppDatabase } from "../db";
import { auditLog } from "../db/schema";
import { generateId } from "./crypto.service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogInput {
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export interface AuditQueryFilters {
  userId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  startDate?: string;
  endDate?: string;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Log an audit entry for a mutation.
 * This is the primary write operation — audit logs are immutable (no delete/update API).
 */
export async function log(
  input: AuditLogInput,
  db?: AppDatabase
): Promise<AuditEntry> {
  const database = db || getDb();

  const id = generateId();
  const now = new Date().toISOString();
  const details = input.details ? JSON.stringify(input.details) : null;

  await database.insert(auditLog).values({
    id,
    userId: input.userId || null,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId || null,
    details,
    ipAddress: input.ipAddress || null,
    createdAt: now,
  });

  return {
    id,
    userId: input.userId || null,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId || null,
    details,
    ipAddress: input.ipAddress || null,
    createdAt: now,
  };
}

/**
 * Query audit logs with filters and pagination.
 */
export async function query(
  filters: AuditQueryFilters = {},
  limit: number = 50,
  offset: number = 0,
  db?: AppDatabase
): Promise<AuditQueryResult> {
  const database = db || getDb();

  // Build conditions
  const conditions = [];

  if (filters.userId) {
    conditions.push(eq(auditLog.userId, filters.userId));
  }

  if (filters.action) {
    conditions.push(eq(auditLog.action, filters.action));
  }

  if (filters.resource) {
    conditions.push(eq(auditLog.resource, filters.resource));
  }

  if (filters.resourceId) {
    conditions.push(eq(auditLog.resourceId, filters.resourceId));
  }

  if (filters.startDate) {
    conditions.push(gte(auditLog.createdAt, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(auditLog.createdAt, filters.endDate));
  }

  const whereClause =
    conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await database
    .select({ count: sql<number>`COUNT(*)` })
    .from(auditLog)
    .where(whereClause);

  const total = countResult[0]?.count ?? 0;

  // Get paginated results
  const entries = await database
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    entries: entries.map((e) => ({
      id: e.id,
      userId: e.userId,
      action: e.action,
      resource: e.resource,
      resourceId: e.resourceId,
      details: e.details,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt,
    })),
    total,
    limit,
    offset,
  };
}

/**
 * Get a single audit entry by ID.
 */
export async function getEntry(
  entryId: string,
  db?: AppDatabase
): Promise<AuditEntry | null> {
  const database = db || getDb();

  const entry = await database.query.auditLog.findFirst({
    where: eq(auditLog.id, entryId),
  });

  if (!entry) return null;

  return {
    id: entry.id,
    userId: entry.userId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId,
    details: entry.details,
    ipAddress: entry.ipAddress,
    createdAt: entry.createdAt,
  };
}
