import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput } from "../helpers/fixtures";
import { setup } from "../../server/services/auth.service";
import {
  validateWebhookSignature,
  DeployError,
} from "../../server/services/deploy.service";
import { generateId, encrypt } from "../../server/services/crypto.service";
import { getDb, type AppDatabase } from "../../server/db";
import { apps, deployments, appEnvVars } from "../../server/db/schema";
import { eq, desc } from "drizzle-orm";

let db: AppDatabase;

beforeEach(async () => {
  db = createTestDb();
  resetTestState();
  await setup(db, validSetupInput);
});

async function createTestApp(overrides: Record<string, unknown> = {}) {
  const id = generateId();
  const now = new Date().toISOString();
  await db.insert(apps).values({
    id,
    name: overrides.name as string || `test-app-${id.slice(0, 8)}`,
    repoUrl: overrides.repoUrl as string || "https://github.com/test/repo.git",
    branch: overrides.branch as string || "main",
    status: "created",
    webhookSecret: overrides.webhookSecret as string || "test-secret",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  return id;
}

describe("Webhook Signature Validation", () => {
  it("validates correct GitHub HMAC signature", async () => {
    const secret = "webhook-secret";
    const payload = '{"ref":"refs/heads/main"}';

    // Generate correct signature
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payload)
    );

    const sigHex = Buffer.from(new Uint8Array(mac)).toString("hex");
    const signature = `sha256=${sigHex}`;

    const valid = await validateWebhookSignature(payload, signature, secret);
    expect(valid).toBe(true);
  });

  it("rejects invalid signature", async () => {
    const valid = await validateWebhookSignature(
      '{"ref":"refs/heads/main"}',
      "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      "secret"
    );
    expect(valid).toBe(false);
  });

  it("rejects signature without sha256= prefix", async () => {
    const valid = await validateWebhookSignature(
      "payload",
      "invalid-format",
      "secret"
    );
    expect(valid).toBe(false);
  });

  it("rejects modified payload", async () => {
    const secret = "webhook-secret";
    const originalPayload = '{"ref":"refs/heads/main"}';

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(originalPayload)
    );

    const sigHex = Buffer.from(new Uint8Array(mac)).toString("hex");
    const signature = `sha256=${sigHex}`;

    // Verify original passes
    expect(await validateWebhookSignature(originalPayload, signature, secret)).toBe(true);

    // Modified payload should fail
    const valid = await validateWebhookSignature(
      '{"ref":"refs/heads/develop"}',
      signature,
      secret
    );
    expect(valid).toBe(false);
  });
});

describe("Deploy Data Model", () => {
  it("creates deployment records correctly", async () => {
    const appId = await createTestApp();
    const deployId = generateId();
    const now = new Date().toISOString();

    await db.insert(deployments).values({
      id: deployId,
      appId,
      status: "pending",
      startedAt: now,
      createdAt: now,
    });

    const deploy = await db.query.deployments.findFirst({
      where: eq(deployments.id, deployId),
    });

    expect(deploy).toBeDefined();
    expect(deploy!.appId).toBe(appId);
    expect(deploy!.status).toBe("pending");
  });

  it("deployment status transitions work", async () => {
    const appId = await createTestApp();
    const deployId = generateId();
    const now = new Date().toISOString();

    await db.insert(deployments).values({
      id: deployId,
      appId,
      status: "pending",
      startedAt: now,
      createdAt: now,
    });

    // Transition through statuses
    for (const status of ["building", "deploying", "running"] as const) {
      await db
        .update(deployments)
        .set({ status })
        .where(eq(deployments.id, deployId));

      const deploy = await db.query.deployments.findFirst({
        where: eq(deployments.id, deployId),
      });
      expect(deploy!.status).toBe(status);
    }
  });

  it("failed deploy keeps app in failed state", async () => {
    const appId = await createTestApp();

    await db
      .update(apps)
      .set({ status: "failed", updatedAt: new Date().toISOString() })
      .where(eq(apps.id, appId));

    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    expect(app!.status).toBe("failed");
  });

  it("deployments cascade delete when app is deleted", async () => {
    const appId = await createTestApp();
    const deployId = generateId();
    const now = new Date().toISOString();

    await db.insert(deployments).values({
      id: deployId,
      appId,
      status: "running",
      startedAt: now,
      createdAt: now,
    });

    // Delete app
    await db.delete(apps).where(eq(apps.id, appId));

    // Deployments should be gone
    const remaining = await db.query.deployments.findFirst({
      where: eq(deployments.id, deployId),
    });
    expect(remaining).toBeUndefined();
  });
});

describe("Env Vars in Deploy Context", () => {
  it("env vars are encrypted at rest", async () => {
    const appId = await createTestApp();
    const encrypted = await encrypt("my-secret-value");

    await db.insert(appEnvVars).values({
      id: generateId(),
      appId,
      key: "SECRET",
      encryptedValue: encrypted,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const row = await db.query.appEnvVars.findFirst({
      where: eq(appEnvVars.appId, appId),
    });

    expect(row!.encryptedValue).not.toBe("my-secret-value");
    expect(row!.encryptedValue.length).toBeGreaterThan(0);
  });

  it("env vars cascade delete with app", async () => {
    const appId = await createTestApp();

    await db.insert(appEnvVars).values({
      id: generateId(),
      appId,
      key: "KEY",
      encryptedValue: await encrypt("value"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.delete(apps).where(eq(apps.id, appId));

    const remaining = await db.query.appEnvVars.findMany({
      where: eq(appEnvVars.appId, appId),
    });
    expect(remaining).toHaveLength(0);
  });
});

describe("DeployError", () => {
  it("has correct properties", () => {
    const err = new DeployError("Clone failed", 500);
    expect(err.message).toBe("Clone failed");
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe("DeployError");
    expect(err).toBeInstanceOf(Error);
  });
});
