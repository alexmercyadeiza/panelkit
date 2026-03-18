// ─── GitHub OAuth & API Service ──────────────────────────────────────────────

import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db";
import { settings } from "../db/schema";
import { encrypt, decrypt } from "./crypto.service";

// ─── GitHub Credentials (stored in DB, encrypted) ──────────────────────────

export async function saveGitHubCredentials(
  db: AppDatabase,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const now = new Date().toISOString();
  const encryptedSecret = await encrypt(clientSecret);

  for (const [key, value] of [
    ["github_client_id", clientId],
    ["github_client_secret", encryptedSecret],
  ] as const) {
    const existing = await db.query.settings.findFirst({
      where: eq(settings.key, key),
    });
    if (existing) {
      await db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value, updatedAt: now });
    }
  }
}

export async function getGitHubCredentials(
  db: AppDatabase
): Promise<{ clientId: string; clientSecret: string } | null> {
  const idRow = await db.query.settings.findFirst({
    where: eq(settings.key, "github_client_id"),
  });
  const secretRow = await db.query.settings.findFirst({
    where: eq(settings.key, "github_client_secret"),
  });

  if (!idRow || !secretRow) return null;

  try {
    const clientSecret = await decrypt(secretRow.value);
    return { clientId: idRow.value, clientSecret };
  } catch {
    return null;
  }
}

export async function removeGitHubCredentials(db: AppDatabase): Promise<void> {
  await db.delete(settings).where(eq(settings.key, "github_client_id"));
  await db.delete(settings).where(eq(settings.key, "github_client_secret"));
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  url: string;
  cloneUrl: string;
  defaultBranch: string;
  updatedAt: string;
}

export interface GitHubUser {
  login: string;
  avatarUrl: string;
  name: string | null;
}

const SETTINGS_KEY = "github_token";

// ─── OAuth Helpers ──────────────────────────────────────────────────────────

/**
 * Build the GitHub OAuth authorization URL.
 */
export function getOAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access token.
 */
export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "Failed to get access token"
    );
  }

  return data.access_token;
}

// ─── Token Storage ──────────────────────────────────────────────────────────

/**
 * Encrypt and store the GitHub token in the settings table.
 */
export async function saveGitHubToken(
  db: AppDatabase,
  token: string
): Promise<void> {
  const encrypted = await encrypt(token);
  const now = new Date().toISOString();

  const existing = await db.query.settings.findFirst({
    where: eq(settings.key, SETTINGS_KEY),
  });

  if (existing) {
    await db
      .update(settings)
      .set({ value: encrypted, updatedAt: now })
      .where(eq(settings.key, SETTINGS_KEY));
  } else {
    await db.insert(settings).values({
      key: SETTINGS_KEY,
      value: encrypted,
      updatedAt: now,
    });
  }
}

/**
 * Retrieve and decrypt the stored GitHub token, or null if not set.
 */
export async function getGitHubToken(
  db: AppDatabase
): Promise<string | null> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, SETTINGS_KEY),
  });

  if (!row) return null;

  try {
    return await decrypt(row.value);
  } catch {
    return null;
  }
}

/**
 * Remove the stored GitHub token.
 */
export async function removeGitHubToken(db: AppDatabase): Promise<void> {
  await db.delete(settings).where(eq(settings.key, SETTINGS_KEY));
}

// ─── GitHub API ─────────────────────────────────────────────────────────────

/**
 * List the authenticated user's repositories.
 */
export async function listRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;

  // Paginate to get up to 100 repos
  while (page <= 3) {
    const response = await fetch(
      `https://api.github.com/user/repos?per_page=100&sort=updated&type=all&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = (await response.json()) as Array<{
      id: number;
      name: string;
      full_name: string;
      private: boolean;
      html_url: string;
      clone_url: string;
      default_branch: string;
      updated_at: string;
    }>;

    if (data.length === 0) break;

    for (const repo of data) {
      repos.push({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
        updatedAt: repo.updated_at,
      });
    }

    if (data.length < 100) break;
    page++;
  }

  return repos;
}

/**
 * Get the authenticated GitHub user's profile.
 */
export async function getGitHubUser(token: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    login: string;
    avatar_url: string;
    name: string | null;
  };

  return {
    login: data.login,
    avatarUrl: data.avatar_url,
    name: data.name,
  };
}

/**
 * Transform a standard GitHub clone URL into one with an embedded access token.
 * e.g., https://github.com/user/repo.git -> https://x-access-token:{token}@github.com/user/repo.git
 */
export function getAuthenticatedCloneUrl(
  repoUrl: string,
  token: string
): string {
  try {
    const url = new URL(repoUrl);
    url.username = "x-access-token";
    url.password = token;
    return url.toString();
  } catch {
    // If URL parsing fails, try string replacement
    return repoUrl.replace(
      "https://github.com/",
      `https://x-access-token:${token}@github.com/`
    );
  }
}
