import { createMiddleware } from "hono/factory";
import { getConfig } from "../config";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 300000);

export function rateLimiter(opts?: { max?: number; windowMs?: number }) {
  return createMiddleware(async (c, next) => {
    const config = getConfig();
    const max = opts?.max ?? config.RATE_LIMIT_MAX;
    const windowMs = opts?.windowMs ?? config.RATE_LIMIT_WINDOW_MS;

    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "unknown";

    const key = `${ip}:${c.req.path}`;
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      return c.json({ error: "Too many requests" }, 429);
    }

    await next();
  });
}

// For testing
export function _clearRateLimitStore() {
  store.clear();
}
