// ─── Users Service — Multi-User Management ─────────────────────────────────

import { eq, ne, and } from "drizzle-orm";
import { type AppDatabase } from "../db";
import { users, sessions } from "../db/schema";
import {
  generateId,
  generateSessionToken,
  hashPassword,
} from "./crypto.service";

// ─── Types ──────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "developer" | "viewer";

export interface SafeUser {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  status: "active" | "pending";
  totpEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InviteInput {
  username: string;
  email?: string;
  role: UserRole;
}

export interface InviteResult {
  user: SafeUser;
  inviteToken: string;
}

export interface AcceptInviteInput {
  inviteToken: string;
  password: string;
}

export interface AppAccess {
  userId: string;
  appId: string;
}

// ─── Invite Token Storage (in-memory) ───────────────────────────────────────

const pendingInvites = new Map<
  string,
  { userId: string; expiresAt: number }
>();

// For testing
export function _clearInvites(): void {
  pendingInvites.clear();
}

// ─── List Users ─────────────────────────────────────────────────────────────

export async function listUsers(db: AppDatabase): Promise<SafeUser[]> {
  const rows = await db.select().from(users);

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role as UserRole,
    status: isPendingUser(row.id) ? ("pending" as const) : ("active" as const),
    totpEnabled: row.totpEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function isPendingUser(userId: string): boolean {
  for (const invite of pendingInvites.values()) {
    if (invite.userId === userId) return true;
  }
  return false;
}

// ─── Get User ───────────────────────────────────────────────────────────────

export async function getUser(
  db: AppDatabase,
  userId: string
): Promise<SafeUser | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!row) return null;

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role as UserRole,
    status: isPendingUser(row.id) ? "pending" : "active",
    totpEnabled: row.totpEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Invite User ────────────────────────────────────────────────────────────

export async function inviteUser(
  db: AppDatabase,
  input: InviteInput
): Promise<InviteResult> {
  if (!input.username || input.username.trim().length === 0) {
    throw new UsersError("Username is required", 400);
  }

  if (!["admin", "developer", "viewer"].includes(input.role)) {
    throw new UsersError("Invalid role", 400);
  }

  // Check for duplicate username
  const existing = await db.query.users.findFirst({
    where: eq(users.username, input.username.trim()),
  });

  if (existing) {
    throw new UsersError("Username already taken", 409);
  }

  const id = generateId();
  const now = new Date().toISOString();

  // Create user with a placeholder password (must accept invite to set real password)
  const placeholderHash = await hashPassword(generateSessionToken());

  await db.insert(users).values({
    id,
    username: input.username.trim(),
    email: input.email || null,
    passwordHash: placeholderHash,
    role: input.role,
    createdAt: now,
    updatedAt: now,
  });

  // Generate invite token
  const inviteToken = generateSessionToken();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  pendingInvites.set(inviteToken, { userId: id, expiresAt });

  const user: SafeUser = {
    id,
    username: input.username.trim(),
    email: input.email || null,
    role: input.role,
    status: "pending",
    totpEnabled: false,
    createdAt: now,
    updatedAt: now,
  };

  return { user, inviteToken };
}

// ─── Accept Invite ──────────────────────────────────────────────────────────

export async function acceptInvite(
  db: AppDatabase,
  input: AcceptInviteInput
): Promise<SafeUser> {
  if (!input.inviteToken) {
    throw new UsersError("Invite token is required", 400);
  }

  if (!input.password || input.password.length < 12) {
    throw new UsersError("Password must be at least 12 characters", 400);
  }

  const invite = pendingInvites.get(input.inviteToken);

  if (!invite) {
    throw new UsersError("Invalid or expired invite token", 400);
  }

  if (Date.now() > invite.expiresAt) {
    pendingInvites.delete(input.inviteToken);
    throw new UsersError("Invite token has expired", 400);
  }

  // Update user's password
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();

  await db
    .update(users)
    .set({ passwordHash, updatedAt: now })
    .where(eq(users.id, invite.userId));

  // Remove invite
  pendingInvites.delete(input.inviteToken);

  const user = await getUser(db, invite.userId);

  if (!user) {
    throw new UsersError("User not found after accepting invite", 500);
  }

  return user;
}

// ─── Update User Role ───────────────────────────────────────────────────────

export async function updateUserRole(
  db: AppDatabase,
  userId: string,
  newRole: UserRole
): Promise<SafeUser> {
  if (!["admin", "developer", "viewer"].includes(newRole)) {
    throw new UsersError("Invalid role", 400);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new UsersError("User not found", 404);
  }

  // Prevent demoting the last admin
  if (user.role === "admin" && newRole !== "admin") {
    const adminCount = await countAdmins(db);
    if (adminCount <= 1) {
      throw new UsersError(
        "Cannot change role — this is the last admin account",
        400
      );
    }
  }

  const now = new Date().toISOString();
  await db
    .update(users)
    .set({ role: newRole, updatedAt: now })
    .where(eq(users.id, userId));

  const updated = await getUser(db, userId);

  if (!updated) {
    throw new UsersError("User not found after update", 500);
  }

  return updated;
}

// ─── Delete User ────────────────────────────────────────────────────────────

export async function deleteUser(
  db: AppDatabase,
  userId: string
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new UsersError("User not found", 404);
  }

  // Prevent deleting the last admin
  if (user.role === "admin") {
    const adminCount = await countAdmins(db);
    if (adminCount <= 1) {
      throw new UsersError(
        "Cannot delete the last admin account",
        400
      );
    }
  }

  // Invalidate all sessions for this user
  await db.delete(sessions).where(eq(sessions.userId, userId));

  // Delete user
  await db.delete(users).where(eq(users.id, userId));

  // Clean up any pending invites for this user
  for (const [token, invite] of pendingInvites.entries()) {
    if (invite.userId === userId) {
      pendingInvites.delete(token);
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function countAdmins(db: AppDatabase): Promise<number> {
  const admins = await db.query.users.findMany({
    where: eq(users.role, "admin"),
  });
  return admins.length;
}

// ─── Error Class ────────────────────────────────────────────────────────────

export class UsersError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "UsersError";
  }
}
