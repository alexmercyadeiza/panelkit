// ─── User Management Routes ────────────────────────────────────────────────

import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { authMiddleware } from "../middleware/auth";
import {
  listUsers,
  getUser,
  inviteUser,
  acceptInvite,
  updateUserRole,
  deleteUser,
  UsersError,
} from "../services/users.service";

const usersRoutes = new Hono();

// ─── Validation Schemas ─────────────────────────────────────────────────────

const inviteSchema = z.object({
  username: z.string().min(1, "Username is required"),
  email: z.string().email().optional(),
  role: z.enum(["admin", "developer", "viewer"]),
});

const acceptInviteSchema = z.object({
  inviteToken: z.string().min(1, "Invite token is required"),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

const updateRoleSchema = z.object({
  role: z.enum(["admin", "developer", "viewer"]),
});

// ─── Admin Role Check Middleware ────────────────────────────────────────────

const adminOnly = async (c: any, next: any) => {
  const user = c.get("user");
  if (user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }
  await next();
};

// ─── Auth middleware for most routes ─────────────────────────────────────────

// Accept invite is public (authenticated by invite token)
usersRoutes.post("/accept-invite", async (c) => {
  const body = await c.req.json();
  const parsed = acceptInviteSchema.parse(body);

  const db = getDb();
  const user = await acceptInvite(db, {
    inviteToken: parsed.inviteToken,
    password: parsed.password,
  });

  return c.json({ user });
});

// All remaining routes require auth + admin
usersRoutes.use("*", authMiddleware);

// ─── GET /api/users — List all users ────────────────────────────────────────

usersRoutes.get("/", adminOnly, async (c) => {
  const db = getDb();
  const usersList = await listUsers(db);
  return c.json({ users: usersList });
});

// ─── POST /api/users/invite — Invite a new user ────────────────────────────

usersRoutes.post("/invite", adminOnly, async (c) => {
  const body = await c.req.json();
  const parsed = inviteSchema.parse(body);

  const db = getDb();
  const result = await inviteUser(db, {
    username: parsed.username,
    email: parsed.email,
    role: parsed.role,
  });

  return c.json({ user: result.user, inviteToken: result.inviteToken }, 201);
});

// ─── PUT /api/users/:id/role — Update user role ────────────────────────────

usersRoutes.put("/:id/role", adminOnly, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = updateRoleSchema.parse(body);

  const db = getDb();
  const user = await updateUserRole(db, id, parsed.role);

  return c.json({ user });
});

// ─── DELETE /api/users/:id — Delete a user ──────────────────────────────────

usersRoutes.delete("/:id", adminOnly, async (c) => {
  const id = c.req.param("id");

  const db = getDb();

  // Prevent self-deletion
  const currentUser = c.get("user");
  if (currentUser.id === id) {
    return c.json({ error: "Cannot delete your own account" }, 400);
  }

  await deleteUser(db, id);

  return c.json({ success: true });
});

export { usersRoutes };
