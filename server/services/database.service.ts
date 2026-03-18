// ─── Database Management Service ─────────────────────────────────────────────

import { eq, desc } from "drizzle-orm";
import { type AppDatabase, getDb } from "../db";
import { databases } from "../db/schema";
import { generateId, encrypt, decrypt } from "./crypto.service";
import {
  buildConnectionString,
  buildConnectionStrings,
  type DatabaseType,
} from "../lib/connection-string";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DatabaseRecord {
  id: string;
  name: string;
  type: DatabaseType;
  dbName: string;
  username: string;
  host: string;
  port: number;
  createdAt: string;
}

export interface DatabaseInfo extends DatabaseRecord {
  connectionString: string;
  externalConnectionString?: string;
  password?: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
}

export interface TableInfo {
  name: string;
  type: string;
  rowCount?: number;
}

/**
 * Interface for the actual database connection executor.
 * This abstraction allows tests to mock real MySQL/PG operations.
 */
export interface DatabaseExecutor {
  createDatabase(dbName: string, username: string, password: string, type: DatabaseType): Promise<void>;
  dropDatabase(dbName: string, username: string, type: DatabaseType): Promise<void>;
  listTables(dbName: string, type: DatabaseType, host: string, port: number, username: string, password: string): Promise<TableInfo[]>;
  getTableInfo(dbName: string, tableName: string, type: DatabaseType, host: string, port: number, username: string, password: string): Promise<Record<string, unknown>[]>;
  executeQuery(
    dbName: string,
    query: string,
    type: DatabaseType,
    host: string,
    port: number,
    username: string,
    password: string,
    options?: { timeout?: number; maxRows?: number; readOnly?: boolean }
  ): Promise<QueryResult>;
}

// ─── Reserved Database Names ────────────────────────────────────────────────

const RESERVED_NAMES = new Set([
  // MySQL reserved
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
  // PostgreSQL reserved
  "postgres",
  "template0",
  "template1",
  // General reserved
  "admin",
  "root",
  "test",
]);

// ─── Dangerous SQL Patterns (for read-only mode) ────────────────────────────

const WRITE_PATTERNS = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bDROP\b/i,
  /\bALTER\b/i,
  /\bTRUNCATE\b/i,
  /\bCREATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bSET\b/i,
];

// ─── Credential Generation ──────────────────────────────────────────────────

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*_+-=";
const ALL_CHARS = LOWERCASE + UPPERCASE + DIGITS + SYMBOLS;

/**
 * Generate a cryptographically secure password of given length.
 * Guarantees at least one character from each category.
 */
export function generateSecurePassword(length: number = 24): string {
  if (length < 4) throw new Error("Password length must be at least 4");

  const bytes = crypto.getRandomValues(new Uint8Array(length));
  const chars: string[] = [];

  // Ensure at least one from each category
  chars.push(LOWERCASE[bytes[0] % LOWERCASE.length]);
  chars.push(UPPERCASE[bytes[1] % UPPERCASE.length]);
  chars.push(DIGITS[bytes[2] % DIGITS.length]);
  chars.push(SYMBOLS[bytes[3] % SYMBOLS.length]);

  // Fill remaining with random from all chars
  for (let i = 4; i < length; i++) {
    chars.push(ALL_CHARS[bytes[i] % ALL_CHARS.length]);
  }

  // Shuffle using Fisher-Yates
  const shuffleBytes = crypto.getRandomValues(new Uint8Array(chars.length));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

// ─── Database Name Sanitization ─────────────────────────────────────────────

/**
 * Sanitize a database name to prevent SQL injection.
 * Only allows alphanumeric chars, underscores, and hyphens.
 * Must start with a letter or underscore.
 */
export function sanitizeDbName(name: string): string {
  // Strip anything that isn't alphanumeric, underscore, or hyphen
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "");

  if (sanitized.length === 0) {
    throw new DatabaseError("Database name cannot be empty after sanitization", 400);
  }

  if (sanitized.length > 64) {
    throw new DatabaseError("Database name too long (max 64 characters)", 400);
  }

  // Must start with letter or underscore
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    throw new DatabaseError("Database name must start with a letter or underscore", 400);
  }

  return sanitized;
}

/**
 * Generate a database username from the database name.
 */
function generateUsername(dbName: string): string {
  // Replace hyphens with underscores, limit length
  const base = dbName.replace(/-/g, "_").slice(0, 16);
  // Add random suffix for uniqueness
  const suffix = crypto.getRandomValues(new Uint8Array(3));
  const hex = Array.from(suffix)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${base}_${hex}`;
}

// ─── Default Executor (uses Bun.spawn for real DB operations) ───────────────

export const defaultExecutor: DatabaseExecutor = {
  async createDatabase(dbName, username, password, type) {
    if (type === "mysql") {
      await spawnCommand("mysql", [
        "-u", "root",
        "-e", `CREATE DATABASE \`${dbName}\`; CREATE USER '${username}'@'%' IDENTIFIED BY '${password.replace(/'/g, "\\'")}'; GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${username}'@'%'; FLUSH PRIVILEGES;`,
      ]);
    } else {
      await spawnCommand("psql", [
        "-U", "postgres",
        "-c", `CREATE DATABASE "${dbName}"; CREATE USER "${username}" WITH PASSWORD '${password.replace(/'/g, "\\'")}'; GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${username}";`,
      ]);
    }
  },

  async dropDatabase(dbName, username, type) {
    if (type === "mysql") {
      await spawnCommand("mysql", [
        "-u", "root",
        "-e", `DROP DATABASE IF EXISTS \`${dbName}\`; DROP USER IF EXISTS '${username}'@'%'; FLUSH PRIVILEGES;`,
      ]);
    } else {
      await spawnCommand("psql", [
        "-U", "postgres",
        "-c", `DROP DATABASE IF EXISTS "${dbName}"; DROP USER IF EXISTS "${username}";`,
      ]);
    }
  },

  async listTables(dbName, type, host, port, username, password) {
    let query: string;
    if (type === "mysql") {
      query = `SELECT TABLE_NAME as name, TABLE_TYPE as type, TABLE_ROWS as rowCount FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${dbName}'`;
    } else {
      query = `SELECT tablename as name, 'BASE TABLE' as type FROM pg_tables WHERE schemaname = 'public'`;
    }

    const result = await this.executeQuery(dbName, query, type, host, port, username, password);
    return result.rows as unknown as TableInfo[];
  },

  async getTableInfo(dbName, tableName, type, host, port, username, password) {
    let query: string;
    if (type === "mysql") {
      query = `DESCRIBE \`${tableName.replace(/[^a-zA-Z0-9_]/g, "")}\``;
    } else {
      query = `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tableName.replace(/'/g, "''")}'`;
    }

    const result = await this.executeQuery(dbName, query, type, host, port, username, password);
    return result.rows;
  },

  async executeQuery(dbName, query, type, host, port, username, password, options) {
    const timeout = options?.timeout ?? 30000;
    const maxRows = options?.maxRows ?? 1000;

    let args: string[];
    if (type === "mysql") {
      args = [
        "-u", username,
        `-p${password}`,
        "-h", host,
        "-P", String(port),
        dbName,
        "--batch",
        "--raw",
        "-e", query,
      ];
    } else {
      const connStr = buildConnectionString({
        type: "postgresql",
        username,
        password,
        host,
        port,
        dbName,
      });
      args = [connStr, "-t", "-A", "-F", "\t", "-c", query];
    }

    const cmd = type === "mysql" ? "mysql" : "psql";
    const output = await spawnCommand(cmd, args, timeout);

    // Parse tabular output
    const lines = output.trim().split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) {
      return { columns: [], rows: [], rowCount: 0, truncated: false };
    }

    const columns = lines[0].split("\t");
    const rows: Record<string, unknown>[] = [];
    const truncated = lines.length - 1 > maxRows;

    for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
      const values = lines[i].split("\t");
      const row: Record<string, unknown> = {};
      for (let j = 0; j < columns.length; j++) {
        row[columns[j]] = values[j] ?? null;
      }
      rows.push(row);
    }

    return { columns, rows, rowCount: rows.length, truncated };
  },
};

async function spawnCommand(
  cmd: string,
  args: string[],
  timeout: number = 30000
): Promise<string> {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeout);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new DatabaseError(
      `Database command failed (exit code ${exitCode})`,
      500
    );
  }

  return await new Response(proc.stdout).text();
}

// ─── Service Functions ──────────────────────────────────────────────────────

let _executor: DatabaseExecutor = defaultExecutor;

/**
 * Set a custom executor (used for testing).
 */
export function setExecutor(executor: DatabaseExecutor): void {
  _executor = executor;
}

/**
 * Reset to the default executor.
 */
export function resetExecutor(): void {
  _executor = defaultExecutor;
}

/**
 * Create a new managed database.
 */
export async function createManagedDatabase(
  name: string,
  type: DatabaseType,
  db?: AppDatabase,
  externalHost?: string
): Promise<DatabaseInfo> {
  const database = db || getDb();

  // Sanitize and validate name
  const dbName = sanitizeDbName(name);

  // Check for reserved names
  if (RESERVED_NAMES.has(dbName.toLowerCase())) {
    throw new DatabaseError(
      `"${dbName}" is a reserved database name`,
      400
    );
  }

  // Check for duplicates
  const existing = await database.query.databases.findFirst({
    where: eq(databases.name, name),
  });

  if (existing) {
    throw new DatabaseError(
      `A database with name "${name}" already exists`,
      409
    );
  }

  // Generate credentials
  const username = generateUsername(dbName);
  const password = generateSecurePassword(24);
  const defaultPort = type === "mysql" ? 3306 : 5432;
  const host = "localhost";

  // Create the actual database
  await _executor.createDatabase(dbName, username, password, type);

  // Store metadata with encrypted password
  const id = generateId();
  const encryptedPassword = await encrypt(password);
  const now = new Date().toISOString();

  await database.insert(databases).values({
    id,
    name,
    type,
    dbName,
    username,
    encryptedPassword,
    host,
    port: defaultPort,
    createdAt: now,
  });

  // Build connection strings
  const { internal, external } = buildConnectionStrings({
    type,
    username,
    password,
    host,
    port: defaultPort,
    dbName,
    externalHost,
  });

  return {
    id,
    name,
    type,
    dbName,
    username,
    host,
    port: defaultPort,
    createdAt: now,
    connectionString: internal,
    externalConnectionString: external,
    password,
  };
}

/**
 * List all managed databases (without passwords).
 */
export async function listManagedDatabases(
  db?: AppDatabase
): Promise<DatabaseRecord[]> {
  const database = db || getDb();

  const rows = await database
    .select()
    .from(databases)
    .orderBy(desc(databases.createdAt));

  return rows.map(({ encryptedPassword, ...rest }) => rest);
}

/**
 * Get database info including connection strings.
 * Password is only included when `includePassword` is true.
 */
export async function getDatabaseInfo(
  id: string,
  includePassword: boolean = false,
  db?: AppDatabase,
  externalHost?: string
): Promise<DatabaseInfo | null> {
  const database = db || getDb();

  const row = await database.query.databases.findFirst({
    where: eq(databases.id, id),
  });

  if (!row) return null;

  let password: string | undefined;
  try {
    password = await decrypt(row.encryptedPassword);
  } catch {
    throw new DatabaseError("Failed to decrypt database credentials", 500);
  }

  const { internal, external } = buildConnectionStrings({
    type: row.type as DatabaseType,
    username: row.username,
    password,
    host: row.host,
    port: row.port,
    dbName: row.dbName,
    externalHost,
  });

  return {
    id: row.id,
    name: row.name,
    type: row.type as DatabaseType,
    dbName: row.dbName,
    username: row.username,
    host: row.host,
    port: row.port,
    createdAt: row.createdAt,
    connectionString: internal,
    externalConnectionString: external,
    password: includePassword ? password : undefined,
  };
}

/**
 * Delete a managed database.
 */
export async function deleteManagedDatabase(
  id: string,
  db?: AppDatabase
): Promise<void> {
  const database = db || getDb();

  const row = await database.query.databases.findFirst({
    where: eq(databases.id, id),
  });

  if (!row) {
    throw new DatabaseError("Database not found", 404);
  }

  // Drop the actual database and user
  try {
    await _executor.dropDatabase(
      row.dbName,
      row.username,
      row.type as DatabaseType
    );
  } catch {
    // Best effort — the actual DB server might be down
  }

  // Remove metadata
  await database.delete(databases).where(eq(databases.id, id));
}

/**
 * List tables in a managed database.
 */
export async function listDatabaseTables(
  id: string,
  db?: AppDatabase
): Promise<TableInfo[]> {
  const database = db || getDb();

  const row = await database.query.databases.findFirst({
    where: eq(databases.id, id),
  });

  if (!row) {
    throw new DatabaseError("Database not found", 404);
  }

  let password: string;
  try {
    password = await decrypt(row.encryptedPassword);
  } catch {
    throw new DatabaseError("Failed to decrypt database credentials", 500);
  }

  return _executor.listTables(
    row.dbName,
    row.type as DatabaseType,
    row.host,
    row.port,
    row.username,
    password
  );
}

/**
 * Get info about a specific table.
 */
export async function getDatabaseTableInfo(
  id: string,
  tableName: string,
  db?: AppDatabase
): Promise<Record<string, unknown>[]> {
  const database = db || getDb();

  const row = await database.query.databases.findFirst({
    where: eq(databases.id, id),
  });

  if (!row) {
    throw new DatabaseError("Database not found", 404);
  }

  let password: string;
  try {
    password = await decrypt(row.encryptedPassword);
  } catch {
    throw new DatabaseError("Failed to decrypt database credentials", 500);
  }

  return _executor.getTableInfo(
    row.dbName,
    tableName,
    row.type as DatabaseType,
    row.host,
    row.port,
    row.username,
    password
  );
}

/**
 * Validate a SQL query for read-only mode.
 * Returns an error message if the query contains write operations.
 */
export function validateReadOnlyQuery(query: string): string | null {
  const trimmed = query.trim();

  // Block multi-statement queries (semicolons not at the very end)
  const withoutTrailingSemicolon = trimmed.replace(/;\s*$/, "");
  if (withoutTrailingSemicolon.includes(";")) {
    return "Multi-statement queries are not allowed in read-only mode";
  }

  for (const pattern of WRITE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `Write operations (${pattern.source.replace(/\\b/g, "")}) are not allowed in read-only mode`;
    }
  }

  return null;
}

/**
 * Execute a SQL query against a managed database.
 */
export async function executeDatabaseQuery(
  id: string,
  query: string,
  options?: { timeout?: number; maxRows?: number; readOnly?: boolean },
  db?: AppDatabase
): Promise<QueryResult> {
  const database = db || getDb();

  const row = await database.query.databases.findFirst({
    where: eq(databases.id, id),
  });

  if (!row) {
    throw new DatabaseError("Database not found", 404);
  }

  // Validate read-only mode
  if (options?.readOnly !== false) {
    const violation = validateReadOnlyQuery(query);
    if (violation) {
      throw new DatabaseError(violation, 400);
    }
  }

  let password: string;
  try {
    password = await decrypt(row.encryptedPassword);
  } catch {
    throw new DatabaseError("Failed to decrypt database credentials", 500);
  }

  try {
    return await _executor.executeQuery(
      row.dbName,
      query,
      row.type as DatabaseType,
      row.host,
      row.port,
      row.username,
      password,
      options
    );
  } catch (err) {
    if (err instanceof DatabaseError) throw err;
    // Don't leak raw driver errors
    throw new DatabaseError("Query execution failed", 500);
  }
}

// ─── Error Class ────────────────────────────────────────────────────────────

export class DatabaseError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}
