// ─── Cron Job API Routes ─────────────────────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import {
  createCronJob,
  listCronJobs,
  getCronJob,
  updateCronJob,
  deleteCronJob,
  runCronJob,
  getCronHistory,
  CronError,
} from "../services/cron.service";

const cronRoutes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createCronSchema = z.object({
  name: z.string().min(1, "Name is required").max(128),
  schedule: z.string().min(1, "Schedule is required"),
  command: z.string().min(1, "Command is required"),
  type: z.enum(["command", "http"]).default("command"),
  httpUrl: z.string().url().optional(),
  httpMethod: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional(),
  enabled: z.boolean().default(true),
});

const updateCronSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  schedule: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  type: z.enum(["command", "http"]).optional(),
  httpUrl: z.string().url().optional(),
  httpMethod: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional(),
  enabled: z.boolean().optional(),
});

// ─── Auth middleware for all routes ─────────────────────────────────────────

cronRoutes.use("*", authMiddleware);

// ─── POST /api/cron — Create a new cron job ──────────────────────────────────

cronRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createCronSchema.parse(body);

  const job = await createCronJob(parsed);

  return c.json({ job }, 201);
});

// ─── GET /api/cron — List all cron jobs ──────────────────────────────────────

cronRoutes.get("/", async (c) => {
  const jobs = await listCronJobs();
  return c.json({ jobs });
});

// ─── GET /api/cron/:id — Get a single cron job ──────────────────────────────

cronRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const job = await getCronJob(id);

  if (!job) {
    return c.json({ error: "Cron job not found" }, 404);
  }

  return c.json({ job });
});

// ─── PUT /api/cron/:id — Update a cron job ──────────────────────────────────

cronRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateCronSchema.parse(body);

  const job = await updateCronJob(id, parsed);

  return c.json({ job });
});

// ─── DELETE /api/cron/:id — Delete a cron job ────────────────────────────────

cronRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await deleteCronJob(id);
  return c.json({ success: true });
});

// ─── GET /api/cron/:id/history — Get execution history ──────────────────────

cronRoutes.get("/:id/history", async (c) => {
  const id = c.req.param("id");
  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const history = await getCronHistory(id, limit, offset);
  return c.json({ history });
});

// ─── POST /api/cron/:id/run — Execute a cron job immediately ─────────────────

cronRoutes.post("/:id/run", async (c) => {
  const id = c.req.param("id");
  const execution = await runCronJob(id);
  return c.json({ execution });
});

export { cronRoutes };
