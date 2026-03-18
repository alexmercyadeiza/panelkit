import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput } from "../helpers/fixtures";
import { errorHandler } from "../../server/middleware/error-handler";
import { rateLimiter } from "../../server/middleware/rate-limit";
import { authRoutes } from "../../server/routes/auth.routes";
import { appsRoutes } from "../../server/routes/apps.routes";
import { sql } from "drizzle-orm";
import { getDb } from "../../server/db";

let app: Hono;
let token: string;

function createTestApp() {
  const a = new Hono();
  a.use("*", cors({ origin: "*", credentials: true }));
  a.use("*", secureHeaders());
  a.use("/api/*", rateLimiter({ max: 200, windowMs: 60000 }));
  a.onError(errorHandler);
  a.route("/api/auth", authRoutes);
  a.route("/api/apps", appsRoutes);
  return a;
}

function getCookie(response: Response, name: string): string | null {
  const cookies = response.headers.getSetCookie();
  for (const cookie of cookies) {
    if (cookie.startsWith(`${name}=`)) {
      return cookie.split("=")[1].split(";")[0];
    }
  }
  return null;
}

async function authedRequest(
  path: string,
  init?: RequestInit
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      ...init?.headers,
      Cookie: `panelkit_session=${token}`,
      "Content-Type": "application/json",
    },
  });
}

const validApp = {
  name: "my-app",
  repoUrl: "https://github.com/test/repo.git",
  branch: "main",
};

beforeEach(async () => {
  createTestDb();
  resetTestState();
  app = createTestApp();

  // Setup admin and get token
  const res = await app.request("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validSetupInput),
  });
  token = getCookie(res, "panelkit_session")!;
});

describe("App CRUD", () => {
  it("POST /api/apps creates an app", async () => {
    const res = await authedRequest("/api/apps", {
      method: "POST",
      body: JSON.stringify(validApp),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.app.name).toBe("my-app");
    expect(body.app.repoUrl).toBe("https://github.com/test/repo.git");
    expect(body.app.status).toBe("created");
    expect(body.app.id).toBeDefined();
  });

  it("rejects invalid repo URL", async () => {
    const res = await authedRequest("/api/apps", {
      method: "POST",
      body: JSON.stringify({ ...validApp, repoUrl: "not-a-url" }),
    });

    expect(res.status).toBe(400);
  });

  it("rejects duplicate app name", async () => {
    await authedRequest("/api/apps", {
      method: "POST",
      body: JSON.stringify(validApp),
    });

    const res = await authedRequest("/api/apps", {
      method: "POST",
      body: JSON.stringify(validApp),
    });

    // SQLite unique constraint violation
    expect(res.status).toBe(500);
  });

  it("GET /api/apps lists apps", async () => {
    await authedRequest("/api/apps", {
      method: "POST",
      body: JSON.stringify(validApp),
    });

    const res = await authedRequest("/api/apps");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apps).toBeArray();
    expect(body.apps).toHaveLength(1);
    // Webhook secret should be stripped
    expect(body.apps[0].webhookSecret).toBeUndefined();
  });

  it("GET /api/apps/:id returns a single app", async () => {
    const createRes = await authedRequest("/api/apps", {
      method: "POST",
      body: JSON.stringify(validApp),
    });
    const { app: created } = await createRes.json();

    const res = await authedRequest(`/api/apps/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.app.name).toBe("my-app");
  });

  it("GET /api/apps/:id returns 404 for nonexistent", async () => {
    const res = await authedRequest("/api/apps/nonexistent-id");
    expect(res.status).toBe(404);
  });

  it("PUT /api/apps/:id updates an app", async () => {
    const createRes = await authedRequest("/api/apps", {
      method: "POST",
      body: JSON.stringify(validApp),
    });
    const { app: created } = await createRes.json();

    const res = await authedRequest(`/api/apps/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({ branch: "develop" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.app.branch).toBe("develop");
  });

  it("DELETE /api/apps/:id deletes and cascades", async () => {
    const createRes = await authedRequest("/api/apps", {
      method: "POST",
      body: JSON.stringify(validApp),
    });
    const { app: created } = await createRes.json();

    // Add env vars
    await authedRequest(`/api/apps/${created.id}/env`, {
      method: "POST",
      body: JSON.stringify({ vars: { FOO: "bar" } }),
    });

    // Delete
    const res = await authedRequest(`/api/apps/${created.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    // Verify gone
    const getRes = await authedRequest(`/api/apps/${created.id}`);
    expect(getRes.status).toBe(404);

    // Verify env vars cascade deleted
    const db = getDb();
    const envVars = db.all(
      sql`SELECT * FROM app_env_vars WHERE app_id = ${created.id}`
    );
    expect(envVars).toHaveLength(0);
  });
});

describe("App Env Vars", () => {
  let appId: string;

  beforeEach(async () => {
    const res = await authedRequest("/api/apps", {
      method: "POST",
      body: JSON.stringify(validApp),
    });
    const body = await res.json();
    appId = body.app.id;
  });

  it("POST /api/apps/:id/env sets env vars", async () => {
    const res = await authedRequest(`/api/apps/${appId}/env`, {
      method: "POST",
      body: JSON.stringify({
        vars: { DATABASE_URL: "postgres://localhost/mydb", SECRET: "s3cr3t" },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
  });

  it("GET /api/apps/:id/env returns masked values by default", async () => {
    await authedRequest(`/api/apps/${appId}/env`, {
      method: "POST",
      body: JSON.stringify({ vars: { SECRET: "mysecret" } }),
    });

    const res = await authedRequest(`/api/apps/${appId}/env`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vars.SECRET).toBe("********");
  });

  it("GET /api/apps/:id/env?reveal=true returns decrypted values", async () => {
    await authedRequest(`/api/apps/${appId}/env`, {
      method: "POST",
      body: JSON.stringify({ vars: { SECRET: "mysecretvalue" } }),
    });

    const res = await authedRequest(`/api/apps/${appId}/env?reveal=true`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vars.SECRET).toBe("mysecretvalue");
  });

  it("env var encryption: stored value in DB differs from plaintext", async () => {
    await authedRequest(`/api/apps/${appId}/env`, {
      method: "POST",
      body: JSON.stringify({ vars: { KEY: "plaintext-value" } }),
    });

    const db = getDb();
    const rows = db.all<{ encrypted_value: string }>(
      sql`SELECT encrypted_value FROM app_env_vars WHERE app_id = ${appId}`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].encrypted_value).not.toBe("plaintext-value");
  });

  it("upserts existing env vars", async () => {
    await authedRequest(`/api/apps/${appId}/env`, {
      method: "POST",
      body: JSON.stringify({ vars: { KEY: "original" } }),
    });

    await authedRequest(`/api/apps/${appId}/env`, {
      method: "POST",
      body: JSON.stringify({ vars: { KEY: "updated" } }),
    });

    const res = await authedRequest(`/api/apps/${appId}/env?reveal=true`);
    const body = await res.json();
    expect(body.vars.KEY).toBe("updated");

    // Should still be only 1 row
    const db = getDb();
    const rows = db.all(
      sql`SELECT * FROM app_env_vars WHERE app_id = ${appId}`
    );
    expect(rows).toHaveLength(1);
  });
});

describe("Auth Required", () => {
  it("all app routes require auth", async () => {
    const routes = [
      { path: "/api/apps", method: "GET" },
      { path: "/api/apps", method: "POST" },
      { path: "/api/apps/fake-id", method: "GET" },
      { path: "/api/apps/fake-id", method: "PUT" },
      { path: "/api/apps/fake-id", method: "DELETE" },
      { path: "/api/apps/fake-id/env", method: "GET" },
      { path: "/api/apps/fake-id/env", method: "POST" },
      { path: "/api/apps/fake-id/deploy", method: "POST" },
      { path: "/api/apps/fake-id/rollback", method: "POST" },
      { path: "/api/apps/fake-id/deployments", method: "GET" },
    ];

    for (const route of routes) {
      const res = await app.request(route.path, {
        method: route.method,
        headers: { "Content-Type": "application/json" },
        body: route.method !== "GET" ? JSON.stringify({}) : undefined,
      });

      expect(res.status).toBe(401);
    }
  });
});
