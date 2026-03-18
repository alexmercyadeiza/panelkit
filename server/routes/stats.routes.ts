// ─── Stats API Routes ────────────────────────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { apps } from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { collectServerStats } from "../services/stats.service";
import {
  queryMetrics,
  getLatestMetric,
  aggregateMetrics,
} from "../services/metrics-storage.service";
import { readFile } from "fs/promises";

const statsRoutes = new Hono();

// ─── Auth middleware for all routes ──────────────────────────────────────────

statsRoutes.use("*", authMiddleware);

// ─── Validation ──────────────────────────────────────────────────────────────

const historyQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional(),
  bucketSeconds: z.coerce.number().int().min(1).optional(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get disk space usage by running `df -BG /` and parsing the output.
 * Returns used/total in GB and percent, or defaults if the command fails.
 */
async function getDiskSpace(): Promise<{
  used: number;
  total: number;
  percent: number;
}> {
  try {
    const proc = Bun.spawn(["df", "-BG", "/"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;

    // Output looks like:
    // Filesystem     1G-blocks  Used Available Use% Mounted on
    // /dev/sda1           256G   87G      169G  34% /
    const lines = output.trim().split("\n");
    if (lines.length < 2) return { used: 0, total: 0, percent: 0 };

    const parts = lines[1].trim().split(/\s+/);
    if (parts.length < 5) return { used: 0, total: 0, percent: 0 };

    const total = parseInt(parts[1], 10) || 0;
    const used = parseInt(parts[2], 10) || 0;
    const percentStr = parts[4]?.replace("%", "") || "0";
    const percent = parseInt(percentStr, 10) || 0;

    return { used, total, percent };
  } catch {
    return { used: 0, total: 0, percent: 0 };
  }
}

/**
 * Read system uptime from /proc/uptime (seconds since boot).
 * Falls back to process.uptime() if /proc is unavailable.
 */
async function getUptime(): Promise<number> {
  try {
    const content = await readFile("/proc/uptime", "utf-8");
    const seconds = parseFloat(content.split(/\s+/)[0]);
    if (!isNaN(seconds)) return Math.floor(seconds);
  } catch {
    // fall through
  }
  return Math.floor(process.uptime());
}

// Track whether we've primed the CPU snapshot
let _cpuPrimed = false;

/**
 * Transform raw collectServerStats() output into the shape the dashboard expects:
 * { cpu: number, memory: { used, total, percent }, disk: { used, total, percent },
 *   network: { rx, tx }, uptime: number }
 */
async function getTransformedStats() {
  let raw = await collectServerStats();

  // CPU requires two snapshots to compute a delta. On the very first call,
  // cpu will be null. Prime it by collecting again after a short delay.
  if (!_cpuPrimed) {
    _cpuPrimed = true;
    if (raw.cpu === null) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      raw = await collectServerStats();
    }
  }

  // CPU → single number (percentage)
  const cpu = raw.cpu?.usagePercent ?? 0;

  // Memory → { used (GB), total (GB), percent }
  const memory = {
    used: raw.memory ? Math.round((raw.memory.usedMb / 1024) * 100) / 100 : 0,
    total: raw.memory
      ? Math.round((raw.memory.totalMb / 1024) * 100) / 100
      : 0,
    percent: raw.memory?.usagePercent ?? 0,
  };

  // Disk → actual disk space usage via `df` (not I/O counters from /proc/diskstats)
  const disk = await getDiskSpace();

  // Network → sum all interface bytes, convert to MB
  const networkRxBytes = raw.network.reduce((sum, n) => sum + n.rxBytes, 0);
  const networkTxBytes = raw.network.reduce((sum, n) => sum + n.txBytes, 0);
  const network = {
    rx: Math.round((networkRxBytes / (1024 * 1024)) * 100) / 100,
    tx: Math.round((networkTxBytes / (1024 * 1024)) * 100) / 100,
  };

  // Uptime → seconds
  const uptime = await getUptime();

  return { cpu, memory, disk, network, uptime };
}

// ─── GET /api/stats/server — Current server metrics ─────────────────────────

statsRoutes.get("/server", async (c) => {
  const stats = await getTransformedStats();
  // Return both at the top level (for Dashboard.tsx) and under `stats` key (for Monitoring.tsx)
  return c.json({ ...stats, stats });
});

// ─── GET /api/stats/server/history — Historical server metrics ──────────────

statsRoutes.get("/server/history", async (c) => {
  const query = historyQuerySchema.parse({
    from: c.req.query("from"),
    to: c.req.query("to"),
    limit: c.req.query("limit"),
    bucketSeconds: c.req.query("bucketSeconds"),
  });

  const db = getDb();

  // If bucketSeconds is provided, return aggregated data
  if (query.bucketSeconds) {
    const from = query.from || new Date(Date.now() - 3600000).toISOString();
    const to = query.to || new Date().toISOString();

    const aggregated = await aggregateMetrics(
      {
        type: "server",
        from,
        to,
        bucketSeconds: query.bucketSeconds,
      },
      db
    );

    return c.json({ metrics: aggregated, aggregated: true });
  }

  // Otherwise return raw metrics
  const metrics = await queryMetrics(
    {
      type: "server",
      from: query.from,
      to: query.to,
      limit: query.limit || 100,
    },
    db
  );

  return c.json({ metrics, aggregated: false });
});

// ─── GET /api/stats/apps/:id — Current app metrics ─────────────────────────

statsRoutes.get("/apps/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  const latest = await getLatestMetric("app", id, db);

  return c.json({
    app: { id: app.id, name: app.name, status: app.status },
    metrics: latest,
  });
});

// ─── GET /api/stats/apps/:id/history — Historical app metrics ───────────────

statsRoutes.get("/apps/:id/history", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  const query = historyQuerySchema.parse({
    from: c.req.query("from"),
    to: c.req.query("to"),
    limit: c.req.query("limit"),
    bucketSeconds: c.req.query("bucketSeconds"),
  });

  if (query.bucketSeconds) {
    const from = query.from || new Date(Date.now() - 3600000).toISOString();
    const to = query.to || new Date().toISOString();

    const aggregated = await aggregateMetrics(
      {
        type: "app",
        appId: id,
        from,
        to,
        bucketSeconds: query.bucketSeconds,
      },
      db
    );

    return c.json({ metrics: aggregated, aggregated: true });
  }

  const metrics = await queryMetrics(
    {
      type: "app",
      appId: id,
      from: query.from,
      to: query.to,
      limit: query.limit || 100,
    },
    db
  );

  return c.json({ metrics, aggregated: false });
});

export { statsRoutes };
