import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput } from "../helpers/fixtures";
import { setup } from "../../server/services/auth.service";
import { generateId } from "../../server/services/crypto.service";
import type { AppDatabase } from "../../server/db";
import { apps } from "../../server/db/schema";
import {
  createHealthCheck,
  getHealthCheck,
  updateHealthCheck,
  deleteHealthCheck,
  runHealthCheck,
  getHealthCheckHistory,
  _clearHistory,
  HealthCheckError,
  type HttpChecker,
} from "../../server/services/health-check.service";

let db: AppDatabase;
let appId: string;

const successChecker: HttpChecker = {
  async check() { return { status: 200, responseTimeMs: 25 }; },
};
const failChecker: HttpChecker = {
  async check() { return { status: 503, responseTimeMs: 100 }; },
};
const timeoutChecker: HttpChecker = {
  async check() { throw new Error("timeout"); },
};
const noopRestarter = { async restart() {} };

beforeEach(async () => {
  db = createTestDb();
  resetTestState();
  _clearHistory();
  await setup(db, validSetupInput);

  appId = generateId();
  const now = new Date().toISOString();
  await db.insert(apps).values({
    id: appId,
    name: "health-test-app",
    repoUrl: "https://github.com/test/repo.git",
    branch: "main",
    status: "running",
    port: 4001,
    createdAt: now,
    updatedAt: now,
  });
});

describe("Health Check — CRUD", () => {
  it("creates a health check", async () => {
    const hc = await createHealthCheck(db, {
      appId,
      endpoint: "/health",
      intervalSeconds: 30,
      timeoutSeconds: 5,
      maxFailures: 3,
    });

    expect(hc.id).toBeDefined();
    expect(hc.appId).toBe(appId);
    expect(hc.endpoint).toBe("/health");
    expect(hc.enabled).toBe(true);
  });

  it("gets a health check by ID", async () => {
    const created = await createHealthCheck(db, {
      appId,
      endpoint: "/status",
    });

    const found = await getHealthCheck(db, created.id);
    expect(found).not.toBeNull();
    expect(found!.endpoint).toBe("/status");
  });

  it("updates a health check", async () => {
    const created = await createHealthCheck(db, {
      appId,
      endpoint: "/health",
    });

    const updated = await updateHealthCheck(db, created.id, {
      endpoint: "/api/health",
      intervalSeconds: 60,
    });

    expect(updated.endpoint).toBe("/api/health");
    expect(updated.intervalSeconds).toBe(60);
  });

  it("deletes a health check", async () => {
    const created = await createHealthCheck(db, {
      appId,
      endpoint: "/health",
    });

    await deleteHealthCheck(db, created.id);

    const found = await getHealthCheck(db, created.id);
    expect(found).toBeNull();
  });
});

describe("Health Check — Execution", () => {
  it("passing health check records success", async () => {
    const hc = await createHealthCheck(db, { appId, endpoint: "/health" });

    const result = await runHealthCheck(db, hc.id, successChecker, noopRestarter);
    expect(result.status).toBe("healthy");
  });

  it("failing health check records failure", async () => {
    const hc = await createHealthCheck(db, { appId, endpoint: "/health" });

    const result = await runHealthCheck(db, hc.id, failChecker, noopRestarter);
    expect(result.status).toBe("unhealthy");
  });

  it("timeout counts as failure", async () => {
    const hc = await createHealthCheck(db, {
      appId,
      endpoint: "/health",
      timeoutSeconds: 1,
    });

    const result = await runHealthCheck(db, hc.id, timeoutChecker, noopRestarter);
    expect(result.status).toBe("unhealthy");
  });

  it("consecutive failures increment counter", async () => {
    const hc = await createHealthCheck(db, {
      appId,
      endpoint: "/health",
      maxFailures: 3,
    });

    await runHealthCheck(db, hc.id, failChecker, noopRestarter);
    await runHealthCheck(db, hc.id, failChecker, noopRestarter);

    const updated = await getHealthCheck(db, hc.id);
    expect(updated!.consecutiveFailures).toBe(2);
  });

  it("success resets consecutive failure counter", async () => {
    const hc = await createHealthCheck(db, {
      appId,
      endpoint: "/health",
      maxFailures: 3,
    });

    await runHealthCheck(db, hc.id, failChecker, noopRestarter);
    await runHealthCheck(db, hc.id, failChecker, noopRestarter);
    await runHealthCheck(db, hc.id, successChecker, noopRestarter);

    const updated = await getHealthCheck(db, hc.id);
    expect(updated!.consecutiveFailures).toBe(0);
  });

  it("health check history is stored", async () => {
    const hc = await createHealthCheck(db, { appId, endpoint: "/health" });

    await runHealthCheck(db, hc.id, successChecker, noopRestarter);
    await runHealthCheck(db, hc.id, successChecker, noopRestarter);

    const history = getHealthCheckHistory(hc.id);
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("auto-restart triggers after maxFailures consecutive failures", async () => {
    let restartCalled = false;
    const trackingRestarter = { async restart() { restartCalled = true; } };

    const hc = await createHealthCheck(db, {
      appId,
      endpoint: "/health",
      maxFailures: 2,
    });

    await runHealthCheck(db, hc.id, failChecker, trackingRestarter);
    expect(restartCalled).toBe(false); // 1 failure, not enough

    await runHealthCheck(db, hc.id, failChecker, trackingRestarter);
    expect(restartCalled).toBe(true); // 2 failures = maxFailures, should restart
  });
});
