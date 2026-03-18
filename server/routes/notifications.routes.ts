// ─── Notification Routes ────────────────────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { authMiddleware } from "../middleware/auth";
import {
  createChannel,
  listChannels,
  deleteChannel,
  testChannel,
  NotificationError,
} from "../services/notification.service";

const notificationsRoutes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createChannelSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.enum(["slack", "discord", "email"]),
  config: z.record(z.unknown()),
  enabled: z.boolean().default(true),
});

// ─── Auth middleware for all routes ──────────────────────────────────────────

notificationsRoutes.use("*", authMiddleware);

// ─── GET /api/notifications/channels — List channels ────────────────────────

notificationsRoutes.get("/channels", async (c) => {
  const db = getDb();
  const channels = await listChannels(db);
  return c.json({ channels });
});

// ─── POST /api/notifications/channels — Create a channel ───────────────────

notificationsRoutes.post("/channels", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const body = await c.req.json();
  const parsed = createChannelSchema.parse(body);

  const db = getDb();
  const channel = await createChannel(db, {
    name: parsed.name,
    type: parsed.type,
    config: parsed.config as any,
    enabled: parsed.enabled,
  });

  return c.json({ channel }, 201);
});

// ─── DELETE /api/notifications/channels/:id — Delete a channel ──────────────

notificationsRoutes.delete("/channels/:id", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const id = c.req.param("id");
  const db = getDb();

  await deleteChannel(db, id);

  return c.json({ success: true });
});

// ─── POST /api/notifications/channels/:id/test — Test a channel ────────────

notificationsRoutes.post("/channels/:id/test", async (c) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const id = c.req.param("id");
  const db = getDb();

  const result = await testChannel(db, id);

  if (!result.success) {
    return c.json(
      { error: "Test notification failed", details: result.error },
      502
    );
  }

  return c.json({ success: true, message: "Test notification sent" });
});

export { notificationsRoutes };
