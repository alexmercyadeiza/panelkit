// ─── Firewall Management Routes ──────────────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import {
  getStatus,
  listRules,
  addRule,
  deleteRule,
  FirewallError,
} from "../services/firewall.service";

const firewallRoutes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const addRuleSchema = z.object({
  port: z.union([
    z.number().int().min(1).max(65535),
    z.string().min(1),
  ]),
  protocol: z.enum(["tcp", "udp", "any"]).default("any"),
  action: z.enum(["allow", "deny"]),
  from: z.string().optional(),
  comment: z.string().max(256).optional(),
});

// ─── Auth middleware for all routes ─────────────────────────────────────────

firewallRoutes.use("*", authMiddleware);

// ─── GET /api/firewall/rules — List all firewall rules ──────────────────────

firewallRoutes.get("/rules", async (c) => {
  const status = await getStatus();
  return c.json({ active: status.active, rules: status.rules });
});

// ─── POST /api/firewall/rules — Add a firewall rule ─────────────────────────

firewallRoutes.post("/rules", async (c) => {
  const body = await c.req.json();
  const parsed = addRuleSchema.parse(body);

  await addRule(parsed);

  return c.json({ success: true }, 201);
});

// ─── DELETE /api/firewall/rules/:number — Delete a firewall rule ─────────────

firewallRoutes.delete("/rules/:number", async (c) => {
  const ruleNumber = parseInt(c.req.param("number"), 10);

  if (isNaN(ruleNumber)) {
    return c.json({ error: "Invalid rule number" }, 400);
  }

  await deleteRule(ruleNumber);

  return c.json({ success: true });
});

export { firewallRoutes };
