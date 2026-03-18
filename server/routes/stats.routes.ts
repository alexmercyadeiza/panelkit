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

// ─── GET /api/stats/server — Current server metrics ─────────────────────────

statsRoutes.get("/server", async (c) => {
  const stats = await collectServerStats();
  return c.json({ stats });
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
