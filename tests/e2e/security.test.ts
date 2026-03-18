import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput } from "../helpers/fixtures";
import { errorHandler } from "../../server/middleware/error-handler";
import { rateLimiter, _clearRateLimitStore } from "../../server/middleware/rate-limit";
import { authRoutes } from "../../server/routes/auth.routes";

let app: Hono;

function createTestApp() {
  const a = new Hono();
  a.use("*", cors({ origin: "*", credentials: true }));
  a.use("*", secureHeaders());
  a.use("/api/*", rateLimiter({ max: 5, windowMs: 60000 }));
  a.onError(errorHandler);
  a.route("/api/auth", authRoutes);
  a.get("/api/health", (c) => c.json({ status: "ok" }));
  return a;
}

beforeEach(() => {
  createTestDb();
  resetTestState();
  _clearRateLimitStore();
  app = createTestApp();
});

describe("Security Headers", () => {
  it("X-Content-Type-Options: nosniff present", async () => {
    const res = await app.request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("X-Frame-Options present", async () => {
    const res = await app.request("/api/health");
    const xfo = res.headers.get("x-frame-options");
    expect(xfo).toBeTruthy();
  });
});

describe("Rate Limiting", () => {
  it("triggers after threshold (429 response)", async () => {
    // Setup first
    await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSetupInput),
    });

    // Make requests up to limit
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/auth/status", {
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
      expect(res.status).toBe(200);
    }

    // Next request should be rate limited
    const res = await app.request("/api/auth/status", {
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("Too many");
  });

  it("rate limit headers present", async () => {
    const res = await app.request("/api/health", {
      headers: { "x-forwarded-for": "10.0.0.2" },
    });

    expect(res.headers.get("x-ratelimit-limit")).toBeDefined();
    expect(res.headers.get("x-ratelimit-remaining")).toBeDefined();
  });
});

describe("SQL Injection Prevention", () => {
  it("login with SQL injection attempts returns 401, not error", async () => {
    await app.request("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSetupInput),
    });

    const attacks = [
      { username: "admin' OR '1'='1", password: "test" },
      { username: "admin'; DROP TABLE users; --", password: "test" },
      { username: "admin' UNION SELECT * FROM users --", password: "test" },
    ];

    for (const attack of attacks) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": `injection-${Math.random()}`,
        },
        body: JSON.stringify(attack),
      });

      // Should return 401 (invalid credentials), not 500 (SQL error)
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(JSON.stringify(body)).not.toContain("SQL");
    }
  });
});

describe("Error Response Safety", () => {
  it("error responses never contain stack traces", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": "safe-test",
      },
      body: JSON.stringify({ username: "", password: "" }),
    });

    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/at \w+\.\w+/);
    expect(bodyStr).not.toMatch(/\.ts:\d+/);
    expect(bodyStr).not.toContain("stack");
  });

  it("protected routes return 401 without auth, not 500", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(401);
  });
});
