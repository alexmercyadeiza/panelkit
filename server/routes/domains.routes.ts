// ─── Domain Management Routes ────────────────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import {
  addDomain,
  removeDomain,
  listDomains,
  getDomain,
  checkDns,
  DomainError,
} from "../services/domain.service";

const domainsRoutes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const addDomainSchema = z.object({
  appId: z.string().min(1, "App ID is required"),
  domain: z.string().min(1, "Domain is required"),
});

// ─── Auth middleware for all routes ─────────────────────────────────────────

domainsRoutes.use("*", authMiddleware);

// ─── POST /api/domains — Add a custom domain ────────────────────────────────

domainsRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = addDomainSchema.parse(body);

  const domain = await addDomain(parsed.appId, parsed.domain);

  return c.json({ domain }, 201);
});

// ─── GET /api/domains — List all domains ─────────────────────────────────────

domainsRoutes.get("/", async (c) => {
  const appId = c.req.query("appId");
  const domainsList = await listDomains(appId || undefined);
  return c.json({ domains: domainsList });
});

// ─── GET /api/domains/:id — Get a single domain ─────────────────────────────

domainsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const domain = await getDomain(id);

  if (!domain) {
    return c.json({ error: "Domain not found" }, 404);
  }

  return c.json({ domain });
});

// ─── GET /api/domains/:id/dns-check — Check DNS for a domain ────────────────

domainsRoutes.get("/:id/dns-check", async (c) => {
  const id = c.req.param("id");
  const expectedIp = c.req.query("expectedIp");

  const result = await checkDns(id, expectedIp || undefined);

  return c.json({ dns: result });
});

// ─── DELETE /api/domains/:id — Remove a domain ──────────────────────────────

domainsRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  await removeDomain(id);

  return c.json({ success: true });
});

export { domainsRoutes };
