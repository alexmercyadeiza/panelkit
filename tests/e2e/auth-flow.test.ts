import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput, validLoginInput } from "../helpers/fixtures";
import { errorHandler } from "../../server/middleware/error-handler";
import { rateLimiter } from "../../server/middleware/rate-limit";
import { authRoutes } from "../../server/routes/auth.routes";

let app: Hono;

function createTestApp() {
  const a = new Hono();
  a.use("*", cors({ origin: "*", credentials: true }));
  a.use("*", secureHeaders());
  a.use("/api/*", rateLimiter({ max: 50, windowMs: 60000 }));
  a.onError(errorHandler);
  a.route("/api/auth", authRoutes);
  a.get("/api/health", (c) => c.json({ status: "ok" }));
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

beforeEach(() => {
  createTestDb();
  resetTestState();
  app = createTestApp();
});

describe("E2E Auth Flow", () => {
  it("POST /api/auth/setup returns 201 on first run", async () => {
    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSetupInput),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.username).toBe("admin");
    expect(body.user.role).toBe("admin");

    // Should set session cookie
    const cookie = getCookie(res, "panelkit_session");
    expect(cookie).toBeTruthy();
  });

  it("POST /api/auth/setup returns 409 on second run", async () => {
    await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSetupInput),
    });

    const res = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "admin2",
        email: "admin2@example.com",
        password: "anothersecurepassword!",
      }),
    });

    expect(res.status).toBe(409);
  });

  it("POST /api/auth/login returns 200 with session cookie", async () => {
    // Setup first
    await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSetupInput),
    });

    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validLoginInput),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.username).toBe("admin");

    const cookie = getCookie(res, "panelkit_session");
    expect(cookie).toBeTruthy();
  });

  it("GET /api/auth/me returns 200 with user info when authenticated", async () => {
    // Setup
    const setupRes = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSetupInput),
    });
    const token = getCookie(setupRes, "panelkit_session");

    const res = await app.request("/api/auth/me", {
      headers: { Cookie: `panelkit_session=${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.username).toBe("admin");
    expect(body.user.role).toBe("admin");
  });

  it("GET /api/auth/me returns 401 with no cookie", async () => {
    const res = await app.request("/api/auth/me");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
    // Should not leak internal details
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("GET /api/auth/me returns 401 with invalid cookie", async () => {
    const res = await app.request("/api/auth/me", {
      headers: { Cookie: "panelkit_session=invalidtoken123" },
    });

    expect(res.status).toBe(401);
  });

  it("POST /api/auth/logout invalidates session", async () => {
    // Setup and get token
    const setupRes = await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSetupInput),
    });
    const token = getCookie(setupRes, "panelkit_session");

    // Logout
    const logoutRes = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `panelkit_session=${token}` },
    });
    expect(logoutRes.status).toBe(200);

    // Subsequent request should be 401
    const meRes = await app.request("/api/auth/me", {
      headers: { Cookie: `panelkit_session=${token}` },
    });
    expect(meRes.status).toBe(401);
  });

  it("protected routes return 401 without auth, not 500", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(JSON.stringify(body)).not.toContain("stack");
    expect(JSON.stringify(body)).not.toContain("TypeError");
  });

  it("security headers are present on responses", async () => {
    const res = await app.request("/api/health");

    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBeTruthy();
  });

  it("error responses never leak stack traces", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "", password: "" }),
    });

    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    // Should not contain stack trace patterns like "at Object." or "at /path/file.ts:123"
    expect(bodyStr).not.toMatch(/at \w+\.\w+/);
    expect(bodyStr).not.toMatch(/\.ts:\d+/);
    expect(bodyStr).not.toContain("Error:");
    expect(bodyStr).not.toContain("stack");
  });

  it("health endpoint returns status ok", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
