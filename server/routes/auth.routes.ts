import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import { getDb } from "../db";
import {
  setup,
  login,
  logout,
  validateSession,
  isSetupComplete,
} from "../services/auth.service";
import { authMiddleware } from "../middleware/auth";

const authRoutes = new Hono();

const setupSchema = z.object({
  username: z.string().min(1, "Username is required"),
  email: z.string().email("Valid email is required"),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

// GET /api/auth/status — Check if setup is needed
authRoutes.get("/status", async (c) => {
  const db = getDb();
  const setupDone = await isSetupComplete(db);
  return c.json({ setupComplete: setupDone });
});

// POST /api/auth/setup — Initial admin setup
authRoutes.post("/setup", async (c) => {
  const body = await c.req.json();
  const parsed = setupSchema.parse(body);

  const db = getDb();
  const result = await setup(db, parsed);

  setCookie(c, "panelkit_session", result.token, {
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return c.json({ user: result.user }, 201);
});

// POST /api/auth/login
authRoutes.post("/login", async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.parse(body);

  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";

  const db = getDb();
  const result = await login(db, parsed, ip);

  if (result.requireTotp) {
    return c.json({ requireTotp: true }, 200);
  }

  setCookie(c, "panelkit_session", result.token, {
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return c.json({ user: result.user }, 200);
});

// GET /api/auth/me — Get current user
authRoutes.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");
  return c.json({ user });
});

// POST /api/auth/logout
authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, "panelkit_session") ||
    c.req.header("Authorization")?.replace("Bearer ", "");

  if (token) {
    const db = getDb();
    await logout(db, token);
  }

  deleteCookie(c, "panelkit_session", { path: "/" });
  return c.json({ success: true });
});

export { authRoutes };
