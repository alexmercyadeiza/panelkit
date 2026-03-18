// ─── App CRUD, Deploy, Env & Webhook Routes ─────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "../db";
import { apps, deployments, appEnvVars } from "../db/schema";
import {
  generateId,
  encrypt,
  decrypt,
  generateWebhookSecret,
} from "../services/crypto.service";
import {
  queueDeploy,
  rollback,
  validateWebhookSignature,
  DeployError,
} from "../services/deploy.service";
import { releaseAppPorts } from "../lib/port-manager";
import { authMiddleware } from "../middleware/auth";

const appsRoutes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createAppSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "Name must be lowercase alphanumeric with dashes"),
  repoUrl: z.string().url("Invalid repository URL"),
  branch: z.string().default("main"),
  buildCommand: z.string().optional(),
  startCommand: z.string().optional(),
  autoDeployEnabled: z.boolean().default(true),
});

const updateAppSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
  repoUrl: z.string().url().optional(),
  branch: z.string().optional(),
  buildCommand: z.string().nullable().optional(),
  startCommand: z.string().nullable().optional(),
  autoDeployEnabled: z.boolean().optional(),
});

const envVarsSchema = z.object({
  vars: z.record(z.string(), z.string()),
});

// ─── Auth middleware for all routes ─────────────────────────────────────────

appsRoutes.use("*", authMiddleware);

// ─── POST /api/apps — Create a new app ──────────────────────────────────────

appsRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createAppSchema.parse(body);

  const db = getDb();
  const id = generateId();
  const webhookSecret = generateWebhookSecret();
  const now = new Date().toISOString();

  await db.insert(apps).values({
    id,
    name: parsed.name,
    repoUrl: parsed.repoUrl,
    branch: parsed.branch,
    buildCommand: parsed.buildCommand || null,
    startCommand: parsed.startCommand || null,
    deployMode: "pm2",
    autoDeployEnabled: parsed.autoDeployEnabled,
    webhookSecret,
    createdAt: now,
    updatedAt: now,
  });

  const app = await db.query.apps.findFirst({ where: eq(apps.id, id) });

  return c.json({ app }, 201);
});

// ─── GET /api/apps — List all apps ──────────────────────────────────────────

appsRoutes.get("/", async (c) => {
  const db = getDb();
  const allApps = await db.select().from(apps).orderBy(desc(apps.createdAt));

  // Strip webhook secrets from list view
  const sanitized = allApps.map(({ webhookSecret, ...rest }) => rest);

  return c.json({ apps: sanitized });
});

// ─── GET /api/apps/:id — Get a single app ───────────────────────────────────

appsRoutes.get("/:id", async (c) => {
  const db = getDb();
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, c.req.param("id")),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  // Strip webhook secret
  const { webhookSecret, ...safe } = app;

  return c.json({ app: safe });
});

// ─── PUT /api/apps/:id — Update an app ──────────────────────────────────────

appsRoutes.put("/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const existing = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!existing) {
    return c.json({ error: "App not found" }, 404);
  }

  const body = await c.req.json();
  const parsed = updateAppSchema.parse(body);

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.repoUrl !== undefined) updates.repoUrl = parsed.repoUrl;
  if (parsed.branch !== undefined) updates.branch = parsed.branch;
  if (parsed.buildCommand !== undefined) updates.buildCommand = parsed.buildCommand;
  if (parsed.startCommand !== undefined) updates.startCommand = parsed.startCommand;
  if (parsed.autoDeployEnabled !== undefined) updates.autoDeployEnabled = parsed.autoDeployEnabled;

  await db.update(apps).set(updates).where(eq(apps.id, id));

  const updated = await db.query.apps.findFirst({ where: eq(apps.id, id) });
  const { webhookSecret, ...safe } = updated!;

  return c.json({ app: safe });
});

// ─── DELETE /api/apps/:id — Delete an app ───────────────────────────────────

appsRoutes.delete("/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  // Stop and remove PM2 process if running
  if (app.containerId) {
    try {
      const proc = Bun.spawn(["pm2", "delete", app.containerId], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    } catch {
      // Best effort cleanup
    }
  }

  // Release allocated ports
  if (app.port) {
    releaseAppPorts(id, db);
  }

  // Delete app (cascades to env vars, deployments)
  await db.delete(apps).where(eq(apps.id, id));

  return c.json({ success: true });
});

// ─── POST /api/apps/:id/deploy — Trigger deploy ────────────────────────────

appsRoutes.post("/:id/deploy", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  // Fire and forget — don't await the deploy, return immediately
  queueDeploy(id, db).catch((err) => {
    console.error(`[deploy] Deploy failed for ${app.name}:`, err);
  });

  // Return the latest pending deployment ID
  const latestDeploy = await db
    .select()
    .from(deployments)
    .where(eq(deployments.appId, id))
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  return c.json({
    success: true,
    deploymentId: latestDeploy[0]?.id || null,
    message: "Deploy started",
  }, 202);
});

// ─── POST /api/apps/:id/rollback — Rollback to previous deployment ─────────

appsRoutes.post("/:id/rollback", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  let targetDeploymentId: string | undefined;
  try {
    const body = await c.req.json();
    targetDeploymentId = body?.deploymentId;
  } catch {
    // No body is fine — rollback to most recent
  }

  const result = await rollback(id, targetDeploymentId, db);

  if (!result.success) {
    return c.json(
      {
        error: "Rollback failed",
        deploymentId: result.deploymentId,
        details: result.error,
      },
      500
    );
  }

  return c.json({
    success: true,
    deploymentId: result.deploymentId,
    containerId: result.containerId,
    port: result.port,
  });
});

// ─── POST /api/apps/:id/env — Set environment variables ────────────────────

appsRoutes.post("/:id/env", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  const body = await c.req.json();
  const parsed = envVarsSchema.parse(body);
  const now = new Date().toISOString();

  // Upsert each variable
  for (const [key, value] of Object.entries(parsed.vars)) {
    const encrypted = await encrypt(value);

    // Check if this key already exists for the app
    const existing = await db.query.appEnvVars.findFirst({
      where: (row, { and, eq: eq_ }) =>
        and(eq_(row.appId, id), eq_(row.key, key)),
    });

    if (existing) {
      await db
        .update(appEnvVars)
        .set({ encryptedValue: encrypted, updatedAt: now })
        .where(eq(appEnvVars.id, existing.id));
    } else {
      await db.insert(appEnvVars).values({
        id: generateId(),
        appId: id,
        key,
        encryptedValue: encrypted,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return c.json({ success: true, count: Object.keys(parsed.vars).length });
});

// ─── GET /api/apps/:id/env — Get environment variables (masked) ─────────────

appsRoutes.get("/:id/env", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  const envRows = await db.query.appEnvVars.findMany({
    where: eq(appEnvVars.appId, id),
  });

  // Return keys with masked values for security
  const showValues = c.req.query("reveal") === "true";

  const vars: Record<string, string> = {};
  for (const row of envRows) {
    if (showValues) {
      try {
        vars[row.key] = await decrypt(row.encryptedValue);
      } catch {
        vars[row.key] = "***DECRYPT_ERROR***";
      }
    } else {
      vars[row.key] = "********";
    }
  }

  return c.json({ vars });
});

// ─── POST /api/apps/:id/webhook — GitHub webhook endpoint ──────────────────

const webhookRoute = new Hono();

// Webhook route does NOT use authMiddleware — authenticated by signature
webhookRoute.post("/:id/webhook", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  if (!app.autoDeployEnabled) {
    return c.json({ message: "Auto-deploy is disabled" }, 200);
  }

  if (!app.webhookSecret) {
    return c.json({ error: "Webhook secret not configured" }, 400);
  }

  // Validate GitHub signature
  const signature = c.req.header("x-hub-signature-256") || "";
  const payload = await c.req.text();

  const valid = await validateWebhookSignature(
    payload,
    signature,
    app.webhookSecret
  );

  if (!valid) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Check if this is a push event to the configured branch
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(payload);
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const ref = body.ref as string | undefined;
  if (ref && !ref.endsWith(`/${app.branch}`)) {
    return c.json({ message: "Push to non-tracked branch, ignoring" }, 200);
  }

  // Trigger deploy (async — don't await)
  queueDeploy(id, db).catch((err) => {
    console.error(`[webhook] Deploy failed for ${app.name}:`, err);
  });

  return c.json({ message: "Deploy triggered" }, 202);
});

// ─── GET /api/apps/:id/deployments — List deployments ───────────────────────

appsRoutes.get("/:id/deployments", async (c) => {
  const db = getDb();
  const id = c.req.param("id");

  const app = await db.query.apps.findFirst({
    where: eq(apps.id, id),
  });

  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  const limit = parseInt(c.req.query("limit") || "20", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);

  const deploys = await db
    .select()
    .from(deployments)
    .where(eq(deployments.appId, id))
    .orderBy(desc(deployments.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ deployments: deploys });
});

export { appsRoutes, webhookRoute };
