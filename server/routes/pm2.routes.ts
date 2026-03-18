// ─── PM2 Process Management API Routes ───────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import {
  listProcesses,
  getProcess,
  startProcess,
  stopProcess,
  restartProcess,
  deleteProcess,
  getProcessLogs,
  PM2Error,
} from "../services/pm2.service";

const pm2Routes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const startProcessSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(64)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
      "Name must be alphanumeric with dots, dashes, or underscores"
    ),
  script: z.string().min(1, "Script is required"),
  cwd: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  instances: z.number().int().min(1).optional(),
  exec_mode: z.enum(["fork", "cluster"]).optional(),
  max_memory_restart: z.string().optional(),
  watch: z.boolean().optional(),
  interpreter: z.string().optional(),
});

// ─── Auth middleware for all routes ─────────────────────────────────────────

pm2Routes.use("*", authMiddleware);

// ─── GET /api/pm2/processes — List all processes ─────────────────────────────

pm2Routes.get("/processes", async (c) => {
  const processes = await listProcesses();
  return c.json({ processes });
});

// ─── GET /api/pm2/processes/:name — Get a specific process ──────────────────

pm2Routes.get("/processes/:name", async (c) => {
  const name = c.req.param("name");
  const proc = await getProcess(name);

  if (!proc) {
    return c.json({ error: "Process not found" }, 404);
  }

  return c.json({ process: proc });
});

// ─── POST /api/pm2/processes — Start a new process ──────────────────────────

pm2Routes.post("/processes", async (c) => {
  const body = await c.req.json();
  const parsed = startProcessSchema.parse(body);

  const proc = await startProcess(parsed);

  return c.json({ process: proc }, 201);
});

// ─── PUT /api/pm2/processes/:name/restart — Restart a process ────────────────

pm2Routes.put("/processes/:name/restart", async (c) => {
  const name = c.req.param("name");
  await restartProcess(name);
  return c.json({ success: true });
});

// ─── PUT /api/pm2/processes/:name/stop — Stop a process ──────────────────────

pm2Routes.put("/processes/:name/stop", async (c) => {
  const name = c.req.param("name");
  await stopProcess(name);
  return c.json({ success: true });
});

// ─── DELETE /api/pm2/processes/:name — Delete a process ──────────────────────

pm2Routes.delete("/processes/:name", async (c) => {
  const name = c.req.param("name");
  await deleteProcess(name);
  return c.json({ success: true });
});

// ─── GET /api/pm2/processes/:name/logs — Get process logs ────────────────────

pm2Routes.get("/processes/:name/logs", async (c) => {
  const name = c.req.param("name");
  const lines = parseInt(c.req.query("lines") || "100", 10);

  const logs = await getProcessLogs(name, lines);
  return c.json({ logs });
});

export { pm2Routes };
