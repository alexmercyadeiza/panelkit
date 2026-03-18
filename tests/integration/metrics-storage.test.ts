import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import type { AppDatabase } from "../../server/db";
import {
  storeMetric,
  storeMetricsBatch,
  queryMetrics,
  getLatestMetric,
  aggregateMetrics,
  purgeOldMetrics,
} from "../../server/services/metrics-storage.service";

let db: AppDatabase;

beforeEach(() => {
  db = createTestDb();
  resetTestState();
});

describe("Metrics Storage — storeMetric", () => {
  it("stores a metric snapshot and retrieves it by timestamp range", async () => {
    const ts = new Date().toISOString();
    const id = await storeMetric(
      {
        type: "server",
        cpuPercent: 45,
        memoryUsedMb: 4096,
        memoryTotalMb: 16384,
        timestamp: ts,
      },
      db
    );

    expect(id).toBeDefined();

    const results = await queryMetrics(
      {
        type: "server",
        from: new Date(Date.now() - 60000).toISOString(),
        to: new Date(Date.now() + 60000).toISOString(),
      },
      db
    );

    expect(results).toHaveLength(1);
    expect(results[0].cpuPercent).toBe(45);
    expect(results[0].memoryUsedMb).toBe(4096);
  });

  it("stores app-specific metrics", async () => {
    await storeMetric(
      { type: "app", appId: "app-123", cpuPercent: 30, timestamp: new Date().toISOString() },
      db
    );

    const results = await queryMetrics(
      { type: "app", appId: "app-123" },
      db
    );

    expect(results).toHaveLength(1);
    expect(results[0].appId).toBe("app-123");
  });
});

describe("Metrics Storage — storeMetricsBatch", () => {
  it("stores multiple snapshots at once", async () => {
    const now = Date.now();
    const snapshots = Array.from({ length: 12 }, (_, i) => ({
      type: "server" as const,
      cpuPercent: 40 + i,
      memoryUsedMb: 4000 + i * 100,
      memoryTotalMb: 16384,
      timestamp: new Date(now + i * 5000).toISOString(), // 5s intervals
    }));

    const ids = await storeMetricsBatch(snapshots, db);
    expect(ids).toHaveLength(12);

    const results = await queryMetrics({ type: "server" }, db);
    expect(results).toHaveLength(12);
  });

  it("handles empty batch", async () => {
    const ids = await storeMetricsBatch([], db);
    expect(ids).toHaveLength(0);
  });

  it("handles high-frequency writes (100 in quick succession)", async () => {
    const now = Date.now();
    const snapshots = Array.from({ length: 100 }, (_, i) => ({
      type: "server" as const,
      cpuPercent: Math.random() * 100,
      timestamp: new Date(now + i * 10).toISOString(),
    }));

    const ids = await storeMetricsBatch(snapshots, db);
    expect(ids).toHaveLength(100);

    const results = await queryMetrics({ type: "server", limit: 200 }, db);
    expect(results).toHaveLength(100);
  });
});

describe("Metrics Storage — queryMetrics", () => {
  it("filters by time range", async () => {
    const baseTime = new Date("2024-06-01T12:00:00Z");

    await storeMetric(
      { type: "server", cpuPercent: 10, timestamp: new Date(baseTime.getTime() - 60000).toISOString() },
      db
    );
    await storeMetric(
      { type: "server", cpuPercent: 20, timestamp: baseTime.toISOString() },
      db
    );
    await storeMetric(
      { type: "server", cpuPercent: 30, timestamp: new Date(baseTime.getTime() + 60000).toISOString() },
      db
    );

    const results = await queryMetrics(
      {
        type: "server",
        from: new Date(baseTime.getTime() - 1000).toISOString(),
        to: new Date(baseTime.getTime() + 1000).toISOString(),
      },
      db
    );

    expect(results).toHaveLength(1);
    expect(results[0].cpuPercent).toBe(20);
  });

  it("returns empty array for empty time range", async () => {
    const results = await queryMetrics(
      {
        type: "server",
        from: "2099-01-01T00:00:00Z",
        to: "2099-01-02T00:00:00Z",
      },
      db
    );

    expect(results).toBeArray();
    expect(results).toHaveLength(0);
  });

  it("respects limit", async () => {
    for (let i = 0; i < 10; i++) {
      await storeMetric(
        { type: "server", cpuPercent: i, timestamp: new Date(Date.now() + i).toISOString() },
        db
      );
    }

    const results = await queryMetrics(
      { type: "server", limit: 5 },
      db
    );
    expect(results).toHaveLength(5);
  });
});

describe("Metrics Storage — getLatestMetric", () => {
  it("returns the most recent metric", async () => {
    await storeMetric(
      { type: "server", cpuPercent: 10, timestamp: "2024-01-01T00:00:00Z" },
      db
    );
    await storeMetric(
      { type: "server", cpuPercent: 20, timestamp: "2024-01-02T00:00:00Z" },
      db
    );

    const latest = await getLatestMetric("server", undefined, db);
    expect(latest).not.toBeNull();
    expect(latest!.cpuPercent).toBe(20);
  });

  it("returns null when no metrics exist", async () => {
    const latest = await getLatestMetric("server", undefined, db);
    expect(latest).toBeNull();
  });
});

describe("Metrics Storage — aggregateMetrics", () => {
  it("aggregates 12 five-second snapshots into 1-minute bucket", async () => {
    const baseTime = new Date("2024-06-01T12:00:00Z").getTime();

    // Create 12 snapshots at 5-second intervals within a 1-minute window
    const snapshots = Array.from({ length: 12 }, (_, i) => ({
      type: "server" as const,
      cpuPercent: 40 + i * 5, // 40, 45, 50, ..., 95
      memoryUsedMb: 4000,
      memoryTotalMb: 16384,
      timestamp: new Date(baseTime + i * 5000).toISOString(),
    }));

    await storeMetricsBatch(snapshots, db);

    const aggregated = await aggregateMetrics(
      {
        type: "server",
        from: new Date(baseTime - 1000).toISOString(),
        to: new Date(baseTime + 60000).toISOString(),
        bucketSeconds: 60,
      },
      db
    );

    expect(aggregated).toHaveLength(1);
    const bucket = aggregated[0];

    expect(bucket.count).toBe(12);

    // CPU: values were 40, 45, 50, ..., 95
    expect(bucket.cpuPercent.min).toBe(40);
    expect(bucket.cpuPercent.max).toBe(95);
    expect(bucket.cpuPercent.avg).toBeCloseTo(67.5, 0);

    // Memory used: all 4000
    expect(bucket.memoryUsedMb.avg).toBe(4000);
    expect(bucket.memoryUsedMb.min).toBe(4000);
    expect(bucket.memoryUsedMb.max).toBe(4000);

    // Memory total
    expect(bucket.memoryTotalMb).toBe(16384);
  });

  it("creates multiple buckets for data spanning multiple minutes", async () => {
    const baseTime = new Date("2024-06-01T12:00:00Z").getTime();

    // 3 data points: one at 12:00, one at 12:01, one at 12:02
    await storeMetric({ type: "server", cpuPercent: 10, timestamp: new Date(baseTime).toISOString() }, db);
    await storeMetric({ type: "server", cpuPercent: 50, timestamp: new Date(baseTime + 60000).toISOString() }, db);
    await storeMetric({ type: "server", cpuPercent: 90, timestamp: new Date(baseTime + 120000).toISOString() }, db);

    const aggregated = await aggregateMetrics(
      {
        type: "server",
        from: new Date(baseTime - 1000).toISOString(),
        to: new Date(baseTime + 180000).toISOString(),
        bucketSeconds: 60,
      },
      db
    );

    expect(aggregated).toHaveLength(3);
    expect(aggregated[0].cpuPercent.avg).toBe(10);
    expect(aggregated[1].cpuPercent.avg).toBe(50);
    expect(aggregated[2].cpuPercent.avg).toBe(90);
  });

  it("returns empty array for no data in range", async () => {
    const result = await aggregateMetrics(
      {
        type: "server",
        from: "2099-01-01T00:00:00Z",
        to: "2099-01-02T00:00:00Z",
      },
      db
    );
    expect(result).toHaveLength(0);
  });
});

describe("Metrics Storage — purgeOldMetrics", () => {
  it("removes data older than retention period", async () => {
    const now = Date.now();

    // Old metric (2 hours ago)
    await storeMetric(
      { type: "server", cpuPercent: 10, timestamp: new Date(now - 7200000).toISOString() },
      db
    );

    // Recent metric (1 minute ago)
    await storeMetric(
      { type: "server", cpuPercent: 90, timestamp: new Date(now - 60000).toISOString() },
      db
    );

    // Purge data older than 1 hour
    await purgeOldMetrics(3600, db);

    const results = await queryMetrics({ type: "server" }, db);
    expect(results).toHaveLength(1);
    expect(results[0].cpuPercent).toBe(90);
  });

  it("does not remove data within retention period", async () => {
    const now = Date.now();

    await storeMetric(
      { type: "server", cpuPercent: 50, timestamp: new Date(now - 30000).toISOString() },
      db
    );

    // Purge data older than 1 hour
    await purgeOldMetrics(3600, db);

    const results = await queryMetrics({ type: "server" }, db);
    expect(results).toHaveLength(1);
  });
});
