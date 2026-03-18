// ─── Metrics Storage Service ─────────────────────────────────────────────────
//
// Persists metric snapshots to SQLite and provides querying/aggregation.
//

import { eq, and, gte, lte, desc } from "drizzle-orm";
import { type AppDatabase, getDb } from "../db";
import { metrics } from "../db/schema";
import { generateId } from "./crypto.service";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MetricSnapshot {
  type: "server" | "app";
  appId?: string | null;
  cpuPercent?: number | null;
  memoryUsedMb?: number | null;
  memoryTotalMb?: number | null;
  diskUsedGb?: number | null;
  diskTotalGb?: number | null;
  networkRxBytes?: number | null;
  networkTxBytes?: number | null;
  requestCount?: number | null;
  timestamp?: string;
}

export interface MetricRecord extends MetricSnapshot {
  id: string;
  timestamp: string;
}

export interface AggregatedMetric {
  periodStart: string;
  periodEnd: string;
  count: number;
  cpuPercent: { avg: number | null; min: number | null; max: number | null };
  memoryUsedMb: { avg: number | null; min: number | null; max: number | null };
  memoryTotalMb: number | null;
  networkRxBytes: { avg: number | null; min: number | null; max: number | null };
  networkTxBytes: { avg: number | null; min: number | null; max: number | null };
  requestCount: { total: number | null };
}

// ─── Store ───────────────────────────────────────────────────────────────────

/**
 * Store a single metric snapshot.
 */
export async function storeMetric(
  snapshot: MetricSnapshot,
  db?: AppDatabase
): Promise<string> {
  const database = db || getDb();
  const id = generateId();
  const timestamp = snapshot.timestamp || new Date().toISOString();

  await database.insert(metrics).values({
    id,
    type: snapshot.type,
    appId: snapshot.appId || null,
    cpuPercent: snapshot.cpuPercent ?? null,
    memoryUsedMb: snapshot.memoryUsedMb ?? null,
    memoryTotalMb: snapshot.memoryTotalMb ?? null,
    diskUsedGb: snapshot.diskUsedGb ?? null,
    diskTotalGb: snapshot.diskTotalGb ?? null,
    networkRxBytes: snapshot.networkRxBytes ?? null,
    networkTxBytes: snapshot.networkTxBytes ?? null,
    requestCount: snapshot.requestCount ?? null,
    timestamp,
  });

  return id;
}

/**
 * Store multiple metric snapshots in a batch.
 * Uses a transaction for atomicity and reduced SQLite contention.
 */
export async function storeMetricsBatch(
  snapshots: MetricSnapshot[],
  db?: AppDatabase
): Promise<string[]> {
  if (snapshots.length === 0) return [];

  const database = db || getDb();
  const ids: string[] = [];

  const values = snapshots.map((snapshot) => {
    const id = generateId();
    ids.push(id);
    return {
      id,
      type: snapshot.type,
      appId: snapshot.appId || null,
      cpuPercent: snapshot.cpuPercent ?? null,
      memoryUsedMb: snapshot.memoryUsedMb ?? null,
      memoryTotalMb: snapshot.memoryTotalMb ?? null,
      diskUsedGb: snapshot.diskUsedGb ?? null,
      diskTotalGb: snapshot.diskTotalGb ?? null,
      networkRxBytes: snapshot.networkRxBytes ?? null,
      networkTxBytes: snapshot.networkTxBytes ?? null,
      requestCount: snapshot.requestCount ?? null,
      timestamp: snapshot.timestamp || new Date().toISOString(),
    };
  });

  await database.insert(metrics).values(values);

  return ids;
}

// ─── Query ───────────────────────────────────────────────────────────────────

/**
 * Query metrics by type and optional time range.
 * Returns empty array for empty time range — never throws.
 */
export async function queryMetrics(
  options: {
    type: "server" | "app";
    appId?: string;
    from?: string;
    to?: string;
    limit?: number;
    order?: "asc" | "desc";
  },
  db?: AppDatabase
): Promise<MetricRecord[]> {
  const database = db || getDb();

  const conditions = [eq(metrics.type, options.type)];

  if (options.appId) {
    conditions.push(eq(metrics.appId, options.appId));
  }

  if (options.from) {
    conditions.push(gte(metrics.timestamp, options.from));
  }

  if (options.to) {
    conditions.push(lte(metrics.timestamp, options.to));
  }

  const results = await database
    .select()
    .from(metrics)
    .where(and(...conditions))
    .orderBy(
      options.order === "asc" ? metrics.timestamp : desc(metrics.timestamp)
    )
    .limit(options.limit || 1000);

  return results as MetricRecord[];
}

/**
 * Get the latest metric for a given type (and optionally app).
 */
export async function getLatestMetric(
  type: "server" | "app",
  appId?: string,
  db?: AppDatabase
): Promise<MetricRecord | null> {
  const results = await queryMetrics(
    { type, appId, limit: 1, order: "desc" },
    db
  );
  return results[0] || null;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Aggregate raw metric snapshots into time-bucketed summaries.
 *
 * Default: 60-second buckets (12 five-second snapshots -> 1 minute aggregate).
 * Each bucket contains avg/min/max for numeric fields.
 */
export async function aggregateMetrics(
  options: {
    type: "server" | "app";
    appId?: string;
    from: string;
    to: string;
    bucketSeconds?: number;
  },
  db?: AppDatabase
): Promise<AggregatedMetric[]> {
  const records = await queryMetrics(
    {
      type: options.type,
      appId: options.appId,
      from: options.from,
      to: options.to,
      limit: 100000,
      order: "asc",
    },
    db
  );

  if (records.length === 0) return [];

  const bucketMs = (options.bucketSeconds || 60) * 1000;
  const buckets = new Map<number, MetricRecord[]>();

  for (const record of records) {
    const ts = new Date(record.timestamp).getTime();
    const bucketKey = Math.floor(ts / bucketMs) * bucketMs;

    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = [];
      buckets.set(bucketKey, bucket);
    }
    bucket.push(record);
  }

  const aggregated: AggregatedMetric[] = [];

  // Sort bucket keys for consistent ordering
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);

  for (const bucketKey of sortedKeys) {
    const bucket = buckets.get(bucketKey)!;

    const periodStart = new Date(bucketKey).toISOString();
    const periodEnd = new Date(bucketKey + bucketMs).toISOString();

    const cpuValues = bucket
      .map((r) => r.cpuPercent)
      .filter((v): v is number => v !== null && v !== undefined);
    const memValues = bucket
      .map((r) => r.memoryUsedMb)
      .filter((v): v is number => v !== null && v !== undefined);
    const rxValues = bucket
      .map((r) => r.networkRxBytes)
      .filter((v): v is number => v !== null && v !== undefined);
    const txValues = bucket
      .map((r) => r.networkTxBytes)
      .filter((v): v is number => v !== null && v !== undefined);
    const reqValues = bucket
      .map((r) => r.requestCount)
      .filter((v): v is number => v !== null && v !== undefined);

    // Last memoryTotalMb in bucket (doesn't change often)
    const lastMemTotal = bucket
      .map((r) => r.memoryTotalMb)
      .filter((v): v is number => v !== null && v !== undefined);

    aggregated.push({
      periodStart,
      periodEnd,
      count: bucket.length,
      cpuPercent: {
        avg: cpuValues.length > 0 ? avg(cpuValues) : null,
        min: cpuValues.length > 0 ? Math.min(...cpuValues) : null,
        max: cpuValues.length > 0 ? Math.max(...cpuValues) : null,
      },
      memoryUsedMb: {
        avg: memValues.length > 0 ? avg(memValues) : null,
        min: memValues.length > 0 ? Math.min(...memValues) : null,
        max: memValues.length > 0 ? Math.max(...memValues) : null,
      },
      memoryTotalMb: lastMemTotal.length > 0 ? lastMemTotal[lastMemTotal.length - 1] : null,
      networkRxBytes: {
        avg: rxValues.length > 0 ? avg(rxValues) : null,
        min: rxValues.length > 0 ? Math.min(...rxValues) : null,
        max: rxValues.length > 0 ? Math.max(...rxValues) : null,
      },
      networkTxBytes: {
        avg: txValues.length > 0 ? avg(txValues) : null,
        min: txValues.length > 0 ? Math.min(...txValues) : null,
        max: txValues.length > 0 ? Math.max(...txValues) : null,
      },
      requestCount: {
        total: reqValues.length > 0 ? reqValues.reduce((a, b) => a + b, 0) : null,
      },
    });
  }

  return aggregated;
}

// ─── Purge ───────────────────────────────────────────────────────────────────

/**
 * Purge metrics older than the given retention period.
 * @param retentionSeconds — How many seconds of data to keep (default: 7 days)
 * @returns Number of rows deleted
 */
export async function purgeOldMetrics(
  retentionSeconds: number = 7 * 24 * 60 * 60,
  db?: AppDatabase
): Promise<void> {
  const database = db || getDb();
  const cutoff = new Date(Date.now() - retentionSeconds * 1000).toISOString();

  await database
    .delete(metrics)
    .where(lte(metrics.timestamp, cutoff));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 100) / 100;
}
