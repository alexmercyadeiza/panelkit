// ─── GitHub OAuth Routes ────────────────────────────────────────────────────

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { settings } from "../db/schema";
import { getConfig } from "../config";
import { authMiddleware } from "../middleware/auth";
import { z } from "zod";
import {
  getOAuthUrl,
  exchangeCodeForToken,
  saveGitHubToken,
  getGitHubToken,
  removeGitHubToken,
  listRepos,
  getGitHubUser,
  saveGitHubCredentials,
  getGitHubCredentials,
  removeGitHubCredentials,
} from "../services/github.service";

const githubRoutes = new Hono();

// All routes require auth except the callback
githubRoutes.use("*", async (c, next) => {
  // The callback route is validated by OAuth state, not session
  if (c.req.path.endsWith("/callback")) {
    return next();
  }
  return authMiddleware(c, next);
});

// ─── Resolve GitHub credentials (DB first, env fallback) ────────────────────

async function resolveCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  const db = getDb();
  const dbCreds = await getGitHubCredentials(db);
  if (dbCreds) return dbCreds;

  const config = getConfig();
  if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) {
    return {
      clientId: config.GITHUB_CLIENT_ID,
      clientSecret: config.GITHUB_CLIENT_SECRET,
    };
  }

  return null;
}

// ─── GET /api/github/status ─────────────────────────────────────────────────

githubRoutes.get("/status", async (c) => {
  const creds = await resolveCredentials();

  if (!creds) {
    return c.json({ connected: false, configured: false });
  }

  const db = getDb();
  const token = await getGitHubToken(db);

  if (!token) {
    return c.json({ connected: false, configured: true });
  }

  // Validate token by fetching user info
  try {
    const user = await getGitHubUser(token);
    return c.json({ connected: true, configured: true, user });
  } catch {
    // Token is invalid or revoked — clean up
    await removeGitHubToken(db);
    return c.json({ connected: false, configured: true });
  }
});

// ─── GET /api/github/authorize ──────────────────────────────────────────────

githubRoutes.get("/authorize", async (c) => {
  const creds = await resolveCredentials();

  if (!creds) {
    return c.json(
      { error: "GitHub OAuth is not configured. Add your Client ID and Secret in Settings." },
      400
    );
  }

  const requestUrl = new URL(c.req.url);
  const origin = `${requestUrl.protocol}//${requestUrl.host}`;
  const redirectUri = `${origin}/api/github/callback`;

  const state = crypto.randomUUID();

  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db.query.settings.findFirst({
    where: eq(settings.key, "github_oauth_state"),
  });

  if (existing) {
    await db
      .update(settings)
      .set({ value: state, updatedAt: now })
      .where(eq(settings.key, "github_oauth_state"));
  } else {
    await db.insert(settings).values({
      key: "github_oauth_state",
      value: state,
      updatedAt: now,
    });
  }

  const url = getOAuthUrl(creds.clientId, redirectUri, state);

  return c.json({ url });
});

// ─── GET /api/github/callback ───────────────────────────────────────────────

githubRoutes.get("/callback", async (c) => {
  const creds = await resolveCredentials();

  if (!creds) {
    return c.json({ error: "GitHub OAuth not configured" }, 400);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code) {
    return c.json({ error: "Missing authorization code" }, 400);
  }

  const db = getDb();

  const storedState = await db.query.settings.findFirst({
    where: eq(settings.key, "github_oauth_state"),
  });

  if (!storedState || storedState.value !== state) {
    return c.json({ error: "Invalid OAuth state" }, 400);
  }

  await db.delete(settings).where(eq(settings.key, "github_oauth_state"));

  try {
    const token = await exchangeCodeForToken(
      creds.clientId,
      creds.clientSecret,
      code
    );

    // Save encrypted token
    await saveGitHubToken(db, token);

    // Redirect to settings page with success indicator
    const requestUrl = new URL(c.req.url);
    const origin = `${requestUrl.protocol}//${requestUrl.host}`;
    return c.redirect(`${origin}/settings?github=connected`);
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Token exchange failed";
    const requestUrl = new URL(c.req.url);
    const origin = `${requestUrl.protocol}//${requestUrl.host}`;
    return c.redirect(
      `${origin}/settings?github=error&message=${encodeURIComponent(msg)}`
    );
  }
});

// ─── GET /api/github/repos ──────────────────────────────────────────────────

githubRoutes.get("/repos", async (c) => {
  const db = getDb();
  const token = await getGitHubToken(db);

  if (!token) {
    return c.json({ error: "GitHub not connected" }, 400);
  }

  try {
    const repos = await listRepos(token);
    return c.json({ repos });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch repositories",
      },
      500
    );
  }
});

// ─── POST /api/github/disconnect ────────────────────────────────────────────

githubRoutes.post("/disconnect", async (c) => {
  const db = getDb();
  await removeGitHubToken(db);
  return c.json({ success: true });
});

// ─── POST /api/github/credentials ─────────────────────────────────────────

const credentialsSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
});

githubRoutes.post("/credentials", async (c) => {
  const body = await c.req.json();
  const parsed = credentialsSchema.parse(body);

  const db = getDb();
  await saveGitHubCredentials(db, parsed.clientId, parsed.clientSecret);

  return c.json({ success: true });
});

// ─── DELETE /api/github/credentials ───────────────────────────────────────

githubRoutes.delete("/credentials", async (c) => {
  const db = getDb();
  await removeGitHubCredentials(db);
  await removeGitHubToken(db);
  return c.json({ success: true });
});

export { githubRoutes };
