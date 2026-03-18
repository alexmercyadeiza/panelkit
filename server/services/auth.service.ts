import { eq, and } from "drizzle-orm";
import { type AppDatabase } from "../db";
import { users, sessions, settings } from "../db/schema";
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  generateId,
} from "./crypto.service";
import { getConfig } from "../config";

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "developer" | "viewer";
  totpEnabled: boolean;
}

export interface SetupInput {
  username: string;
  email: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
  totpCode?: string;
}

// ─── Rate Limiting (in-memory) ───────────────────────────────────────────────

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 900000 }); // 15 min window
    return true;
  }

  entry.count++;
  return entry.count <= 5;
}

function resetRateLimit(ip: string) {
  loginAttempts.delete(ip);
}

// For testing
export function _clearRateLimits() {
  loginAttempts.clear();
}

// ─── Setup ───────────────────────────────────────────────────────────────────

export async function isSetupComplete(db: AppDatabase): Promise<boolean> {
  const setting = await db.query.settings.findFirst({
    where: eq(settings.key, "setup_complete"),
  });
  return setting?.value === "true";
}

export async function setup(
  db: AppDatabase,
  input: SetupInput
): Promise<{ user: AuthUser; token: string }> {
  const alreadySetup = await isSetupComplete(db);
  if (alreadySetup) {
    throw new AuthError("Setup already completed", 409);
  }

  if (!input.username || input.username.trim().length === 0) {
    throw new AuthError("Username is required", 400);
  }

  if (!input.email || input.email.trim().length === 0) {
    throw new AuthError("Email is required", 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw new AuthError("Invalid email address", 400);
  }

  if (!input.password || input.password.length < 12) {
    throw new AuthError("Password must be at least 12 characters", 400);
  }

  const id = generateId();
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();

  await db.insert(users).values({
    id,
    username: input.username.trim(),
    email: input.email || null,
    passwordHash,
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(settings).values({
    key: "setup_complete",
    value: "true",
    updatedAt: now,
  });

  const token = await createSession(db, id);

  return {
    user: {
      id,
      username: input.username.trim(),
      email: input.email || null,
      role: "admin",
      totpEnabled: false,
    },
    token,
  };
}

// ─── Login ───────────────────────────────────────────────────────────────────

export async function login(
  db: AppDatabase,
  input: LoginInput,
  ip?: string
): Promise<{ user: AuthUser; token: string; requireTotp?: boolean }> {
  if (ip && !checkRateLimit(ip)) {
    throw new AuthError("Too many login attempts. Try again later.", 429);
  }

  if (!input.username || !input.password) {
    throw new AuthError("Username and password are required", 400);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.username, input.username),
  });

  if (!user) {
    throw new AuthError("Invalid credentials", 401);
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) {
    throw new AuthError("Invalid credentials", 401);
  }

  // If 2FA is enabled and no code provided, indicate it's needed
  if (user.totpEnabled && !input.totpCode) {
    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role as AuthUser["role"],
        totpEnabled: true,
      },
      token: "",
      requireTotp: true,
    };
  }

  if (ip) resetRateLimit(ip);

  const token = await createSession(db, user.id, ip);

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role as AuthUser["role"],
      totpEnabled: user.totpEnabled,
    },
    token,
  };
}

// ─── Sessions ────────────────────────────────────────────────────────────────

async function createSession(
  db: AppDatabase,
  userId: string,
  ip?: string,
  userAgent?: string,
  ttlOverride?: number
): Promise<string> {
  const token = generateSessionToken();
  const config = getConfig();
  const ttl = ttlOverride ?? config.SESSION_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  await db.insert(sessions).values({
    id: generateId(),
    userId,
    token,
    expiresAt,
    ipAddress: ip || null,
    userAgent: userAgent || null,
  });

  return token;
}

export async function createSessionWithTTL(
  db: AppDatabase,
  userId: string,
  ttlSeconds: number,
  ip?: string
): Promise<string> {
  return createSession(db, userId, ip, undefined, ttlSeconds);
}

export async function validateSession(
  db: AppDatabase,
  token: string
): Promise<AuthUser | null> {
  if (!token) return null;

  const session = await db.query.sessions.findFirst({
    where: eq(sessions.token, token),
  });

  if (!session) return null;

  // Check expiry
  if (new Date(session.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });

  if (!user) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role as AuthUser["role"],
    totpEnabled: user.totpEnabled,
  };
}

export async function logout(db: AppDatabase, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function invalidateUserSessions(
  db: AppDatabase,
  userId: string
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "AuthError";
  }
}
