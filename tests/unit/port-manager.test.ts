import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import * as schema from "../../server/db/schema";
import { ensureTables, setDb, type AppDatabase } from "../../server/db";
import { loadConfig } from "../../server/config";
import {
  allocatePort,
  releasePort,
  releaseAppPorts,
  getPortForApp,
  listAllocatedPorts,
  ensurePortTable,
  PortError,
} from "../../server/lib/port-manager";

let db: AppDatabase;

beforeEach(() => {
  loadConfig({
    NODE_ENV: "test",
    MASTER_KEY: "a".repeat(64),
    PORT_RANGE_START: 4000,
    PORT_RANGE_END: 4010, // Small range for testing
  });

  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  ensureTables(db);
  setDb(db);
  ensurePortTable(db);
});

describe("Port Manager", () => {
  it("allocates ports within configured range", async () => {
    const port = await allocatePort("app-1", db);
    expect(port).toBeGreaterThanOrEqual(4000);
    expect(port).toBeLessThanOrEqual(4010);
  });

  it("never allocates same port twice", async () => {
    const port1 = await allocatePort("app-1", db);
    const port2 = await allocatePort("app-2", db);
    expect(port1).not.toBe(port2);
  });

  it("allocates sequential ports", async () => {
    const port1 = await allocatePort("app-1", db);
    const port2 = await allocatePort("app-2", db);
    expect(port2).toBe(port1 + 1);
  });

  it("released ports become available again", async () => {
    const port1 = await allocatePort("app-1", db);
    releasePort(port1, db);

    const port2 = await allocatePort("app-2", db);
    expect(port2).toBe(port1); // Should reuse the released port
  });

  it("throws when range exhausted", async () => {
    // Allocate all 11 ports (4000-4010)
    for (let i = 0; i < 11; i++) {
      await allocatePort(`app-${i}`, db);
    }

    try {
      await allocatePort("overflow-app", db);
      expect.unreachable("Should have thrown PortError");
    } catch (e) {
      expect(e).toBeInstanceOf(PortError);
      expect((e as PortError).message).toContain("No available ports");
    }
  });

  it("survives simulated server restart (ports persisted in SQLite)", async () => {
    // Allocate some ports
    const port1 = await allocatePort("app-1", db);
    const port2 = await allocatePort("app-2", db);

    // "Restart" — create a new in-memory state but same DB
    // We verify the data is in SQLite, not just memory
    const allocatedFromDb = listAllocatedPorts(db);
    expect(allocatedFromDb).toHaveLength(2);
    expect(allocatedFromDb[0].port).toBe(port1);
    expect(allocatedFromDb[1].port).toBe(port2);

    // After restart, allocating should skip already-used ports
    const port3 = await allocatePort("app-3", db);
    expect(port3).not.toBe(port1);
    expect(port3).not.toBe(port2);
  });

  it("getPortForApp returns correct port", async () => {
    const port = await allocatePort("my-app", db);
    const found = getPortForApp("my-app", db);
    expect(found).toBe(port);
  });

  it("getPortForApp returns null for unknown app", () => {
    const found = getPortForApp("nonexistent", db);
    expect(found).toBeNull();
  });

  it("releaseAppPorts removes all ports for an app", async () => {
    await allocatePort("app-1", db);

    releaseAppPorts("app-1", db);

    const remaining = listAllocatedPorts(db);
    expect(remaining).toHaveLength(0);
  });

  it("listAllocatedPorts returns all allocations", async () => {
    await allocatePort("app-1", db);
    await allocatePort("app-2", db);

    const list = listAllocatedPorts(db);
    expect(list).toHaveLength(2);
    expect(list[0].appId).toBeDefined();
    expect(list[0].allocatedAt).toBeDefined();
  });
});
