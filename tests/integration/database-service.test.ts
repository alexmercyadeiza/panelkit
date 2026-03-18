import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import type { AppDatabase } from "../../server/db";
import {
  generateSecurePassword,
  sanitizeDbName,
  createManagedDatabase,
  listManagedDatabases,
  getDatabaseInfo,
  deleteManagedDatabase,
  validateReadOnlyQuery,
  executeDatabaseQuery,
  setExecutor,
  resetExecutor,
  DatabaseError,
  type DatabaseExecutor,
  type QueryResult,
} from "../../server/services/database.service";

let db: AppDatabase;

// Mock executor that records calls
function createMockExecutor(): DatabaseExecutor & {
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    async createDatabase(dbName, username, password, type) {
      calls.push({ method: "createDatabase", args: [dbName, username, password, type] });
    },
    async dropDatabase(dbName, username, type) {
      calls.push({ method: "dropDatabase", args: [dbName, username, type] });
    },
    async listTables(dbName, type) {
      calls.push({ method: "listTables", args: [dbName, type] });
      return [{ name: "users", type: "BASE TABLE" }];
    },
    async getTableInfo(dbName, tableName) {
      calls.push({ method: "getTableInfo", args: [dbName, tableName] });
      return [{ column_name: "id", data_type: "integer" }];
    },
    async executeQuery(dbName, query, type, host, port, username, password, options): Promise<QueryResult> {
      calls.push({ method: "executeQuery", args: [dbName, query] });
      return { columns: ["id"], rows: [{ id: 1 }], rowCount: 1, truncated: false };
    },
  };
}

beforeEach(() => {
  db = createTestDb();
  resetTestState();
  const mock = createMockExecutor();
  setExecutor(mock);
});

afterEach(() => {
  resetExecutor();
});

describe("generateSecurePassword", () => {
  it("generates passwords of specified length", () => {
    const pwd = generateSecurePassword(24);
    expect(pwd).toHaveLength(24);
  });

  it("generates passwords with >= 24 chars by default", () => {
    const pwd = generateSecurePassword();
    expect(pwd.length).toBeGreaterThanOrEqual(24);
  });

  it("includes mixed case, numbers, and symbols", () => {
    const pwd = generateSecurePassword(30);
    expect(/[a-z]/.test(pwd)).toBe(true);
    expect(/[A-Z]/.test(pwd)).toBe(true);
    expect(/[0-9]/.test(pwd)).toBe(true);
    expect(/[!@#$%^&*_+\-=]/.test(pwd)).toBe(true);
  });

  it("generates unique passwords", () => {
    const passwords = new Set<string>();
    for (let i = 0; i < 100; i++) {
      passwords.add(generateSecurePassword());
    }
    expect(passwords.size).toBe(100);
  });
});

describe("sanitizeDbName", () => {
  it("accepts valid names", () => {
    expect(sanitizeDbName("my_database")).toBe("my_database");
    expect(sanitizeDbName("app-db")).toBe("app-db");
    expect(sanitizeDbName("_private")).toBe("_private");
  });

  it("strips SQL injection characters", () => {
    const sanitized = sanitizeDbName("db'; DROP TABLE users; --");
    expect(sanitized).not.toContain("'");
    expect(sanitized).not.toContain(";");
    expect(sanitized).not.toContain(" ");
    // Hyphens are allowed in db names, but quotes/semicolons/spaces are stripped
    expect(/^[a-zA-Z0-9_-]+$/.test(sanitized)).toBe(true);
  });

  it("rejects empty name after sanitization", () => {
    expect(() => sanitizeDbName("!@#$")).toThrow(DatabaseError);
  });

  it("rejects names that don't start with letter or underscore", () => {
    expect(() => sanitizeDbName("123db")).toThrow(DatabaseError);
  });

  it("rejects names over 64 chars", () => {
    expect(() => sanitizeDbName("a".repeat(65))).toThrow(DatabaseError);
  });
});

describe("createManagedDatabase", () => {
  it("creates database with valid name and stores metadata", async () => {
    const result = await createManagedDatabase("myapp", "mysql", db);

    expect(result.id).toBeDefined();
    expect(result.name).toBe("myapp");
    expect(result.type).toBe("mysql");
    expect(result.username).toBeDefined();
    expect(result.password).toBeDefined();
    expect(result.password!.length).toBeGreaterThanOrEqual(24);
    expect(result.connectionString).toContain("mysql://");
    expect(result.connectionString).toContain("localhost");
  });

  it("creates PostgreSQL database", async () => {
    const result = await createManagedDatabase("pgdb", "postgresql", db);
    expect(result.connectionString).toContain("postgresql://");
    expect(result.port).toBe(5432);
  });

  it("rejects reserved names", async () => {
    const reservedNames = [
      "information_schema",
      "mysql",
      "postgres",
      "template0",
      "template1",
      "sys",
      "performance_schema",
    ];

    for (const name of reservedNames) {
      try {
        await createManagedDatabase(name, "mysql", db);
        expect.unreachable(`Should have rejected reserved name: ${name}`);
      } catch (e) {
        expect(e).toBeInstanceOf(DatabaseError);
        expect((e as DatabaseError).statusCode).toBe(400);
      }
    }
  });

  it("rejects duplicate database name", async () => {
    await createManagedDatabase("mydb", "mysql", db);

    try {
      await createManagedDatabase("mydb", "mysql", db);
      expect.unreachable("Should have thrown for duplicate");
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError);
      expect((e as DatabaseError).statusCode).toBe(409);
    }
  });

  it("connection string includes all required components", async () => {
    const result = await createManagedDatabase("testdb", "mysql", db);
    const conn = result.connectionString;

    expect(conn).toMatch(/^mysql:\/\//);
    expect(conn).toContain("localhost");
    expect(conn).toContain("3306");
    expect(conn).toContain("testdb"); // db name
    expect(conn).toContain(result.username);
  });
});

describe("listManagedDatabases", () => {
  it("returns list without passwords", async () => {
    await createManagedDatabase("db1", "mysql", db);
    await createManagedDatabase("db2", "postgresql", db);

    const list = await listManagedDatabases(db);
    expect(list).toHaveLength(2);

    for (const item of list) {
      expect((item as any).encryptedPassword).toBeUndefined();
      expect((item as any).password).toBeUndefined();
    }
  });
});

describe("getDatabaseInfo", () => {
  it("returns connection strings without password by default", async () => {
    const created = await createManagedDatabase("mydb", "mysql", db);

    const info = await getDatabaseInfo(created.id, false, db);
    expect(info).not.toBeNull();
    expect(info!.connectionString).toContain("mysql://");
    expect(info!.password).toBeUndefined();
  });

  it("includes password when requested", async () => {
    const created = await createManagedDatabase("mydb", "mysql", db);

    const info = await getDatabaseInfo(created.id, true, db);
    expect(info!.password).toBeDefined();
    expect(info!.password!.length).toBeGreaterThanOrEqual(24);
  });

  it("returns null for nonexistent database", async () => {
    const info = await getDatabaseInfo("nonexistent", false, db);
    expect(info).toBeNull();
  });
});

describe("deleteManagedDatabase", () => {
  it("deletes database and metadata", async () => {
    const created = await createManagedDatabase("todelete", "mysql", db);

    await deleteManagedDatabase(created.id, db);

    const info = await getDatabaseInfo(created.id, false, db);
    expect(info).toBeNull();
  });

  it("throws for nonexistent database", async () => {
    try {
      await deleteManagedDatabase("nonexistent", db);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError);
      expect((e as DatabaseError).statusCode).toBe(404);
    }
  });
});

describe("validateReadOnlyQuery", () => {
  it("allows SELECT queries", () => {
    expect(validateReadOnlyQuery("SELECT * FROM users")).toBeNull();
    expect(validateReadOnlyQuery("SELECT id, name FROM users WHERE id = 1")).toBeNull();
  });

  it("blocks INSERT", () => {
    expect(validateReadOnlyQuery("INSERT INTO users (name) VALUES ('test')")).not.toBeNull();
  });

  it("blocks UPDATE", () => {
    expect(validateReadOnlyQuery("UPDATE users SET name = 'test'")).not.toBeNull();
  });

  it("blocks DELETE", () => {
    expect(validateReadOnlyQuery("DELETE FROM users WHERE id = 1")).not.toBeNull();
  });

  it("blocks DROP", () => {
    expect(validateReadOnlyQuery("DROP TABLE users")).not.toBeNull();
  });

  it("blocks ALTER", () => {
    expect(validateReadOnlyQuery("ALTER TABLE users ADD COLUMN age INT")).not.toBeNull();
  });

  it("blocks TRUNCATE", () => {
    expect(validateReadOnlyQuery("TRUNCATE TABLE users")).not.toBeNull();
  });

  it("blocks CREATE", () => {
    expect(validateReadOnlyQuery("CREATE TABLE evil (id INT)")).not.toBeNull();
  });

  it("blocks GRANT", () => {
    expect(validateReadOnlyQuery("GRANT ALL ON database TO user")).not.toBeNull();
  });

  it("blocks REVOKE", () => {
    expect(validateReadOnlyQuery("REVOKE ALL ON database FROM user")).not.toBeNull();
  });

  it("blocks SET", () => {
    expect(validateReadOnlyQuery("SET autocommit = 0")).not.toBeNull();
  });

  it("blocks multi-statement injection", () => {
    expect(validateReadOnlyQuery("SELECT 1; DROP TABLE users")).not.toBeNull();
  });

  it("allows trailing semicolon", () => {
    expect(validateReadOnlyQuery("SELECT * FROM users;")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(validateReadOnlyQuery("insert into users values (1)")).not.toBeNull();
    expect(validateReadOnlyQuery("Drop Table users")).not.toBeNull();
  });
});

describe("executeDatabaseQuery", () => {
  it("returns results for valid query", async () => {
    const created = await createManagedDatabase("querydb", "mysql", db);

    const result = await executeDatabaseQuery(
      created.id,
      "SELECT * FROM users",
      { readOnly: true },
      db
    );

    expect(result.columns).toBeArray();
    expect(result.rows).toBeArray();
  });

  it("throws for nonexistent database", async () => {
    try {
      await executeDatabaseQuery("nonexistent", "SELECT 1", {}, db);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError);
      expect((e as DatabaseError).statusCode).toBe(404);
    }
  });

  it("blocks write queries in read-only mode", async () => {
    const created = await createManagedDatabase("querydb2", "mysql", db);

    try {
      await executeDatabaseQuery(
        created.id,
        "DROP TABLE users",
        { readOnly: true },
        db
      );
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DatabaseError);
      expect((e as DatabaseError).statusCode).toBe(400);
    }
  });
});
