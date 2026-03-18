import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { validateSession, type AuthUser } from "../services/auth.service";
import { getDb } from "../db";

// Extend Hono context
declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
    token: string;
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const token =
    getCookie(c, "panelkit_session") ||
    c.req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const db = getDb();
  const user = await validateSession(db, token);

  if (!user) {
    return c.json({ error: "Invalid or expired session" }, 401);
  }

  c.set("user", user);
  c.set("token", token);

  await next();
});
