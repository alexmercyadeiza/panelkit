// ─── Database Management Routes ──────────────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import {
  createManagedDatabase,
  listManagedDatabases,
  getDatabaseInfo,
  deleteManagedDatabase,
  executeDatabaseQuery,
  listDatabaseTables,
  getDatabaseTableInfo,
  DatabaseError,
} from "../services/database.service";

const databasesRoutes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createDatabaseSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(64, "Name too long (max 64 characters)")
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_-]*$/,
      "Name must start with a letter or underscore and contain only alphanumeric, underscore, or hyphen characters"
    ),
  type: z.enum(["mysql", "postgresql"]),
});

const querySchema = z.object({
  query: z.string().min(1, "Query is required").max(10000, "Query too long"),
  readOnly: z.boolean().default(true),
  timeout: z.number().int().min(1000).max(60000).default(30000),
  maxRows: z.number().int().min(1).max(10000).default(1000),
});

// ─── Auth middleware for all routes ─────────────────────────────────────────

databasesRoutes.use("*", authMiddleware);

// ─── POST /api/databases — Create a new managed database ────────────────────

databasesRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createDatabaseSchema.parse(body);

  const result = await createManagedDatabase(parsed.name, parsed.type);

  // Return password only on creation
  return c.json(
    {
      database: {
        id: result.id,
        name: result.name,
        type: result.type,
        dbName: result.dbName,
        username: result.username,
        host: result.host,
        port: result.port,
        createdAt: result.createdAt,
        connectionString: result.connectionString,
        externalConnectionString: result.externalConnectionString,
        password: result.password,
      },
    },
    201
  );
});

// ─── GET /api/databases — List all managed databases ────────────────────────

databasesRoutes.get("/", async (c) => {
  const dbList = await listManagedDatabases();
  return c.json({ databases: dbList });
});

// ─── GET /api/databases/:id/info — Get database info with connection strings ─

databasesRoutes.get("/:id/info", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  // Only admins can see the password
  const includePassword = user.role === "admin";
  const externalHost = c.req.query("externalHost");

  const info = await getDatabaseInfo(
    id,
    includePassword,
    undefined,
    externalHost || undefined
  );

  if (!info) {
    return c.json({ error: "Database not found" }, 404);
  }

  return c.json({ database: info });
});

// ─── GET /api/databases/:id/tables — List tables ────────────────────────────

databasesRoutes.get("/:id/tables", async (c) => {
  const id = c.req.param("id");

  const tables = await listDatabaseTables(id);
  return c.json({ tables });
});

// ─── GET /api/databases/:id/tables/:table — Get table info ──────────────────

databasesRoutes.get("/:id/tables/:table", async (c) => {
  const id = c.req.param("id");
  const tableName = c.req.param("table");

  const columns = await getDatabaseTableInfo(id, tableName);
  return c.json({ table: tableName, columns });
});

// ─── POST /api/databases/:id/query — Execute SQL query ──────────────────────

databasesRoutes.post("/:id/query", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = querySchema.parse(body);

  const result = await executeDatabaseQuery(
    id,
    parsed.query,
    {
      readOnly: parsed.readOnly,
      timeout: parsed.timeout,
      maxRows: parsed.maxRows,
    }
  );

  return c.json({ result });
});

// ─── DELETE /api/databases/:id — Delete a managed database ──────────────────

databasesRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  await deleteManagedDatabase(id);

  return c.json({ success: true });
});

export { databasesRoutes };
