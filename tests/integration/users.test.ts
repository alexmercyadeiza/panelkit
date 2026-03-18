import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput } from "../helpers/fixtures";
import { setup, validateSession } from "../../server/services/auth.service";
import type { AppDatabase } from "../../server/db";
import {
  listUsers,
  inviteUser,
  acceptInvite,
  updateUserRole,
  deleteUser,
  _clearInvites,
  UsersError,
} from "../../server/services/users.service";

let db: AppDatabase;
let adminId: string;

beforeEach(async () => {
  db = createTestDb();
  resetTestState();
  _clearInvites();

  const result = await setup(db, validSetupInput);
  adminId = result.user.id;
});

describe("User Management — Invite", () => {
  it("invites a user and returns invite token", async () => {
    const result = await inviteUser(db, {
      username: "newdev",
      email: "dev@example.com",
      role: "developer",
    });

    expect(result.user.username).toBe("newdev");
    expect(result.user.role).toBe("developer");
    expect(result.user.status).toBe("pending");
    expect(result.inviteToken).toBeDefined();
    expect(result.inviteToken.length).toBeGreaterThan(0);
  });

  it("rejects duplicate username", async () => {
    try {
      await inviteUser(db, {
        username: "admin", // already exists from setup
        role: "developer",
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UsersError);
      expect((e as UsersError).statusCode).toBe(409);
    }
  });

  it("rejects empty username", async () => {
    try {
      await inviteUser(db, { username: "", role: "developer" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UsersError);
      expect((e as UsersError).statusCode).toBe(400);
    }
  });
});

describe("User Management — Accept Invite", () => {
  it("accepts invite, sets password, activates account", async () => {
    const { inviteToken } = await inviteUser(db, {
      username: "newuser",
      role: "viewer",
    });

    const user = await acceptInvite(db, {
      inviteToken,
      password: "securepassword123!",
    });

    expect(user.username).toBe("newuser");
    expect(user.status).toBe("active");
  });

  it("rejects short password", async () => {
    const { inviteToken } = await inviteUser(db, {
      username: "shortpwd",
      role: "viewer",
    });

    try {
      await acceptInvite(db, {
        inviteToken,
        password: "short",
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UsersError);
      expect((e as UsersError).statusCode).toBe(400);
    }
  });

  it("rejects invalid invite token", async () => {
    try {
      await acceptInvite(db, {
        inviteToken: "invalid-token-123",
        password: "securepassword123!",
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UsersError);
    }
  });
});

describe("User Management — Roles", () => {
  it("admin can change user role", async () => {
    const { user: invited } = await inviteUser(db, {
      username: "devuser",
      role: "developer",
    });

    const updated = await updateUserRole(db, invited.id, "viewer");
    expect(updated.role).toBe("viewer");
  });

  it("cannot demote last admin", async () => {
    try {
      await updateUserRole(db, adminId, "developer");
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UsersError);
      expect((e as UsersError).message).toContain("last admin");
    }
  });

  it("can demote admin if another admin exists", async () => {
    const { user: secondAdmin } = await inviteUser(db, {
      username: "admin2",
      role: "admin",
    });

    // Now we have 2 admins, so demoting one should work
    const updated = await updateUserRole(db, secondAdmin.id, "developer");
    expect(updated.role).toBe("developer");
  });
});

describe("User Management — Delete", () => {
  it("deletes a user", async () => {
    const { user: invited } = await inviteUser(db, {
      username: "tobedeleted",
      role: "viewer",
    });

    await deleteUser(db, invited.id);

    const users = await listUsers(db);
    const found = users.find((u) => u.id === invited.id);
    expect(found).toBeUndefined();
  });

  it("cannot delete last admin", async () => {
    try {
      await deleteUser(db, adminId);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UsersError);
      expect((e as UsersError).message).toContain("last admin");
    }
  });

  it("deleting user removes them from list", async () => {
    const { user: invited } = await inviteUser(db, {
      username: "removeme",
      role: "developer",
    });

    const beforeDelete = await listUsers(db);
    expect(beforeDelete).toHaveLength(2);

    await deleteUser(db, invited.id);

    const afterDelete = await listUsers(db);
    expect(afterDelete).toHaveLength(1);
  });
});

describe("User Management — List", () => {
  it("lists users without passwords", async () => {
    const users = await listUsers(db);
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe("admin");

    // Should not contain sensitive fields
    const userObj = users[0] as any;
    expect(userObj.passwordHash).toBeUndefined();
    expect(userObj.password_hash).toBeUndefined();
  });
});
