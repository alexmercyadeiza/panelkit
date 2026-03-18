// ─── Port Allocation Manager ─────────────────────────────────────────────────

import { getDb, type AppDatabase } from "../db";
import { getConfig } from "../config";
import { sql } from "drizzle-orm";

// Ensure the allocated_ports table exists
export function ensurePortTable(db: AppDatabase): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS allocated_ports (
    port INTEGER PRIMARY KEY,
    app_id TEXT NOT NULL,
    allocated_at TEXT NOT NULL
  )`);
}

export interface PortAllocation {
  port: number;
  appId: string;
  allocatedAt: string;
}

/**
 * Allocate the next available port from the configured range.
 * Ports are persisted in SQLite to survive restarts.
 */
export async function allocatePort(
  appId: string,
  db?: AppDatabase
): Promise<number> {
  const database = db || getDb();
  const config = getConfig();
  const rangeStart = config.PORT_RANGE_START;
  const rangeEnd = config.PORT_RANGE_END;

  ensurePortTable(database);

  // Get all allocated ports
  const allocated = database.all<{ port: number }>(
    sql`SELECT port FROM allocated_ports ORDER BY port`
  );
  const allocatedSet = new Set(allocated.map((r) => r.port));

  // Find first available port in range
  for (let port = rangeStart; port <= rangeEnd; port++) {
    if (!allocatedSet.has(port)) {
      // Check if port is bound on the system
      const bound = await isPortBound(port);
      if (bound) continue;

      const now = new Date().toISOString();
      database.run(
        sql`INSERT INTO allocated_ports (port, app_id, allocated_at) VALUES (${port}, ${appId}, ${now})`
      );
      return port;
    }
  }

  throw new PortError(
    `No available ports in range ${rangeStart}-${rangeEnd}`,
    503
  );
}

/**
 * Release a previously allocated port.
 */
export function releasePort(port: number, db?: AppDatabase): void {
  const database = db || getDb();
  ensurePortTable(database);
  database.run(sql`DELETE FROM allocated_ports WHERE port = ${port}`);
}

/**
 * Release all ports allocated to a given app.
 */
export function releaseAppPorts(appId: string, db?: AppDatabase): void {
  const database = db || getDb();
  ensurePortTable(database);
  database.run(sql`DELETE FROM allocated_ports WHERE app_id = ${appId}`);
}

/**
 * Get port allocated to a specific app.
 */
export function getPortForApp(
  appId: string,
  db?: AppDatabase
): number | null {
  const database = db || getDb();
  ensurePortTable(database);
  const result = database.all<{ port: number }>(
    sql`SELECT port FROM allocated_ports WHERE app_id = ${appId} LIMIT 1`
  );
  return result.length > 0 ? result[0].port : null;
}

/**
 * List all allocated ports.
 */
export function listAllocatedPorts(db?: AppDatabase): PortAllocation[] {
  const database = db || getDb();
  ensurePortTable(database);
  return database.all<PortAllocation>(
    sql`SELECT port, app_id as appId, allocated_at as allocatedAt FROM allocated_ports ORDER BY port`
  );
}

/**
 * Check if a port is already bound on the system by attempting
 * to listen on it briefly.
 */
export async function isPortBound(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch() {
          return new Response("");
        },
      });
      // Port is available — close and return false
      server.stop(true);
      resolve(false);
    } catch {
      // Port is in use
      resolve(true);
    }
  });
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class PortError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "PortError";
  }
}
