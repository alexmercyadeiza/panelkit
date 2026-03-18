import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import type { AppDatabase } from "../../server/db";
import {
  log as auditLog,
  query as auditQuery,
  getEntry,
} from "../../server/services/audit.service";

let db: AppDatabase;

beforeEach(() => {
  db = createTestDb();
  resetTestState();
});

describe("Audit Logging", () => {
  it("creates an audit entry", async () => {
    const entry = await auditLog(
      {
        userId: "user-1",
        action: "create",
        resource: "app",
        resourceId: "app-1",
        details: { name: "my-app" },
        ipAddress: "192.168.1.1",
      },
      db
    );

    expect(entry.id).toBeDefined();
    expect(entry.action).toBe("create");
    expect(entry.resource).toBe("app");
    expect(entry.userId).toBe("user-1");
    expect(entry.ipAddress).toBe("192.168.1.1");

    const fetched = await getEntry(entry.id, db);
    expect(fetched).not.toBeNull();
    expect(fetched!.action).toBe("create");
  });

  it("stores details as JSON", async () => {
    const entry = await auditLog(
      {
        userId: "user-1",
        action: "update",
        resource: "app",
        resourceId: "app-1",
        details: { old: { name: "old" }, new: { name: "new" } },
      },
      db
    );

    const fetched = await getEntry(entry.id, db);
    expect(fetched!.details).toBeDefined();
    const parsed = JSON.parse(fetched!.details!);
    expect(parsed.old.name).toBe("old");
    expect(parsed.new.name).toBe("new");
  });

  it("query filters by user", async () => {
    await auditLog({ userId: "user-1", action: "create", resource: "app" }, db);
    await auditLog({ userId: "user-2", action: "create", resource: "app" }, db);

    const result = await auditQuery({ userId: "user-1" }, 50, 0, db);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].userId).toBe("user-1");
  });

  it("query filters by action", async () => {
    await auditLog({ userId: "user-1", action: "create", resource: "app" }, db);
    await auditLog({ userId: "user-1", action: "delete", resource: "app" }, db);

    const result = await auditQuery({ action: "delete" }, 50, 0, db);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].action).toBe("delete");
  });

  it("query filters by resource", async () => {
    await auditLog({ userId: "user-1", action: "create", resource: "app" }, db);
    await auditLog({ userId: "user-1", action: "create", resource: "database" }, db);

    const result = await auditQuery({ resource: "database" }, 50, 0, db);
    expect(result.entries).toHaveLength(1);
  });

  it("query filters by time range", async () => {
    const now = new Date();
    const before = new Date(now.getTime() - 60000).toISOString();
    const after = new Date(now.getTime() + 60000).toISOString();

    await auditLog({ userId: "user-1", action: "create", resource: "app" }, db);

    const result = await auditQuery({ startDate: before, endDate: after }, 50, 0, db);
    expect(result.entries).toHaveLength(1);

    const noResults = await auditQuery(
      { startDate: "2099-01-01T00:00:00Z", endDate: "2099-01-02T00:00:00Z" },
      50, 0, db
    );
    expect(noResults.entries).toHaveLength(0);
  });

  it("query supports pagination", async () => {
    for (let i = 0; i < 10; i++) {
      await auditLog({ userId: "user-1", action: "action", resource: "res" }, db);
    }

    const page1 = await auditQuery({}, 3, 0, db);
    expect(page1.entries).toHaveLength(3);
    expect(page1.total).toBe(10);

    const page2 = await auditQuery({}, 3, 3, db);
    expect(page2.entries).toHaveLength(3);

    expect(page1.entries[0].id).not.toBe(page2.entries[0].id);
  });

  it("entries contain timestamps", async () => {
    await auditLog({ userId: "u1", action: "test", resource: "x" }, db);

    const result = await auditQuery({}, 50, 0, db);
    expect(result.entries[0].createdAt).toBeDefined();
    expect(new Date(result.entries[0].createdAt).getTime()).not.toBeNaN();
  });
});
