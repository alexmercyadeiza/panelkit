import { createMiddleware } from "hono/factory";
import type { AuthUser } from "../services/auth.service";

type Role = AuthUser["role"];

const roleHierarchy: Record<Role, number> = {
  admin: 3,
  developer: 2,
  viewer: 1,
};

export function requireRole(...allowedRoles: Role[]) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!allowedRoles.includes(user.role)) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    await next();
  });
}

export function requireMinRole(minRole: Role) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");

    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (roleHierarchy[user.role] < roleHierarchy[minRole]) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    await next();
  });
}
