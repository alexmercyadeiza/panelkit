import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput, makeSetupInput } from "../helpers/fixtures";
import {
  setup,
  login,
  logout,
  validateSession,
  isSetupComplete,
  createSessionWithTTL,
  _clearRateLimits,
  AuthError,
} from "../../server/services/auth.service";
import type { AppDatabase } from "../../server/db";

let db: AppDatabase;

beforeEach(() => {
  db = createTestDb();
  resetTestState();
});

describe("Setup Wizard", () => {
  it("creates admin account with valid credentials", async () => {
    const result = await setup(db, validSetupInput);

    expect(result.user.username).toBe("admin");
    expect(result.user.role).toBe("admin");
    expect(result.user.email).toBe("admin@example.com");
    expect(result.token).toHaveLength(64);
  });

  it("marks setup as complete", async () => {
    await setup(db, validSetupInput);
    expect(await isSetupComplete(db)).toBe(true);
  });

  it("rejects empty password", async () => {
    try {
      await setup(db, makeSetupInput({ password: "" }));
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(400);
    }
  });

  it("rejects password shorter than 12 characters", async () => {
    try {
      await setup(db, makeSetupInput({ password: "short" }));
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(400);
    }
  });

  it("rejects missing username", async () => {
    try {
      await setup(db, makeSetupInput({ username: "" }));
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(400);
    }
  });

  it("cannot run twice (locked after first admin)", async () => {
    await setup(db, validSetupInput);

    try {
      await setup(db, makeSetupInput({ username: "admin2" }));
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(409);
    }
  });
});

describe("Login", () => {
  beforeEach(async () => {
    await setup(db, validSetupInput);
    _clearRateLimits();
  });

  it("succeeds with correct credentials", async () => {
    const result = await login(db, {
      username: "admin",
      password: "supersecurepassword123!",
    });

    expect(result.user.username).toBe("admin");
    expect(result.token).toHaveLength(64);
  });

  it("fails with wrong password", async () => {
    try {
      await login(db, {
        username: "admin",
        password: "wrongpassword123!",
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(401);
    }
  });

  it("fails with nonexistent user", async () => {
    try {
      await login(db, {
        username: "nobody",
        password: "supersecurepassword123!",
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(401);
    }
  });

  it("fails with empty fields", async () => {
    try {
      await login(db, { username: "", password: "" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(400);
    }
  });

  it("rejects SQL injection attempts", async () => {
    try {
      await login(db, {
        username: "admin' OR '1'='1",
        password: "supersecurepassword123!",
      });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(401);
    }
  });

  it("rate limits after 5+ failed logins from same IP", async () => {
    const ip = "192.168.1.100";

    for (let i = 0; i < 5; i++) {
      try {
        await login(db, { username: "admin", password: "wrong" }, ip);
      } catch {
        // expected
      }
    }

    try {
      await login(db, { username: "admin", password: "wrong" }, ip);
      expect.unreachable("Should have thrown rate limit error");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).statusCode).toBe(429);
    }
  });
});

describe("Session Management", () => {
  let token: string;

  beforeEach(async () => {
    const result = await setup(db, validSetupInput);
    token = result.token;
    _clearRateLimits();
  });

  it("validates a valid session and returns user", async () => {
    const user = await validateSession(db, token);
    expect(user).not.toBeNull();
    expect(user!.username).toBe("admin");
    expect(user!.role).toBe("admin");
  });

  it("returns null for expired session", async () => {
    // Create session with 1 second TTL
    const loginResult = await login(db, {
      username: "admin",
      password: "supersecurepassword123!",
    });

    // Create a session with already-expired time
    const shortToken = await createSessionWithTTL(
      db,
      loginResult.user.id,
      -1 // negative TTL = already expired
    );

    const user = await validateSession(db, shortToken);
    expect(user).toBeNull();
  });

  it("returns null for tampered token", async () => {
    const user = await validateSession(db, "tampered" + token.slice(8));
    expect(user).toBeNull();
  });

  it("returns null for empty token", async () => {
    const user = await validateSession(db, "");
    expect(user).toBeNull();
  });

  it("logout invalidates session immediately", async () => {
    // Verify session is valid
    expect(await validateSession(db, token)).not.toBeNull();

    // Logout
    await logout(db, token);

    // Session should be invalid now
    expect(await validateSession(db, token)).toBeNull();
  });
});
