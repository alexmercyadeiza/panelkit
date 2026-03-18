import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput } from "../helpers/fixtures";
import { errorHandler } from "../../server/middleware/error-handler";
import { rateLimiter } from "../../server/middleware/rate-limit";
import { authRoutes } from "../../server/routes/auth.routes";
import { databasesRoutes } from "../../server/routes/databases.routes";
import {
  setExecutor,
  resetExecutor,
  type DatabaseExecutor,
  type QueryResult,
} from "../../server/services/database.service";

let app: Hono;
let adminToken: string;

function createMockExecutor(): DatabaseExecutor {
  return {
    async createDatabase() {},
    async dropDatabase() {},
    async listTables() {
      return [
        { name: "users", type: "BASE TABLE", rowCount: 42 },
        { name: "posts", type: "BASE TABLE", rowCount: 100 },
      ];
    },
    async getTableInfo() {
      return [
        { column_name: "id", data_type: "integer", is_nullable: "NO" },
        { column_name: "name", data_type: "varchar", is_nullable: "YES" },
      ];
    },
    async executeQuery(
      dbName, query, type, host, port, username, password, options
    ): Promise<QueryResult> {
      return {
        columns: ["id", "name"],
        rows: [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ],
        rowCount: 2,
        truncated: false,
      };
    },
  };
}

function createTestApp() {
  const a = new Hono();
  a.use("*", cors({ origin: "*", credentials: true }));
  a.use("*", secureHeaders());
  a.use("/api/*", rateLimiter({ max: 200, windowMs: 60000 }));
  a.onError(errorHandler);
  a.route("/api/auth", authRoutes);
  a.route("/api/databases", databasesRoutes);
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
      Cookie: `panelkit_session=${adminToken}`,
      "Content-Type": "application/json",
    },
  });
}

beforeEach(async () => {
  createTestDb();
  resetTestState();
  setExecutor(createMockExecutor());
  app = createTestApp();

  const res = await app.request("/api/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validSetupInput),
  });
  adminToken = getCookie(res, "panelkit_session")!;
});

afterEach(() => {
  resetExecutor();
});

describe("Database API — E2E", () => {
  it("POST /api/databases creates a database", async () => {
    const res = await authedRequest("/api/databases", {
      method: "POST",
      body: JSON.stringify({ name: "myappdb", type: "mysql" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.database.name).toBe("myappdb");
    expect(body.database.type).toBe("mysql");
    expect(body.database.connectionString).toContain("mysql://");
    // Password should be included on creation
    expect(body.database.password).toBeDefined();
  });

  it("GET /api/databases lists databases", async () => {
    await authedRequest("/api/databases", {
      method: "POST",
      body: JSON.stringify({ name: "db1", type: "mysql" }),
    });
    await authedRequest("/api/databases", {
      method: "POST",
      body: JSON.stringify({ name: "db2", type: "postgresql" }),
    });

    const res = await authedRequest("/api/databases");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.databases).toHaveLength(2);
  });

  it("GET /api/databases/:id/info returns connection strings", async () => {
    const createRes = await authedRequest("/api/databases", {
      method: "POST",
      body: JSON.stringify({ name: "infodb", type: "postgresql" }),
    });
    const { database } = await createRes.json();

    const res = await authedRequest(`/api/databases/${database.id}/info`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.database.connectionString).toContain("postgresql://");
    // Admin should see password
    expect(body.database.password).toBeDefined();
  });

  it("POST /api/databases/:id/query executes a query", async () => {
    const createRes = await authedRequest("/api/databases", {
      method: "POST",
      body: JSON.stringify({ name: "querydb", type: "mysql" }),
    });
    const { database } = await createRes.json();

    const res = await authedRequest(`/api/databases/${database.id}/query`, {
      method: "POST",
      body: JSON.stringify({ query: "SELECT * FROM users" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.columns).toBeArray();
    expect(body.result.rows).toBeArray();
  });

  it("POST /api/databases/:id/query rejects write in read-only mode", async () => {
    const createRes = await authedRequest("/api/databases", {
      method: "POST",
      body: JSON.stringify({ name: "readonlydb", type: "mysql" }),
    });
    const { database } = await createRes.json();

    const res = await authedRequest(`/api/databases/${database.id}/query`, {
      method: "POST",
      body: JSON.stringify({ query: "DROP TABLE users", readOnly: true }),
    });

    expect(res.status).toBe(400);
  });

  it("DELETE /api/databases/:id deletes a database", async () => {
    const createRes = await authedRequest("/api/databases", {
      method: "POST",
      body: JSON.stringify({ name: "todelete", type: "mysql" }),
    });
    const { database } = await createRes.json();

    const res = await authedRequest(`/api/databases/${database.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    // Confirm it's gone
    const listRes = await authedRequest("/api/databases");
    const body = await listRes.json();
    expect(body.databases).toHaveLength(0);
  });

  it("all endpoints require auth", async () => {
    const routes = [
      { path: "/api/databases", method: "GET" },
      { path: "/api/databases", method: "POST" },
      { path: "/api/databases/fake-id/info", method: "GET" },
      { path: "/api/databases/fake-id/query", method: "POST" },
      { path: "/api/databases/fake-id", method: "DELETE" },
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
