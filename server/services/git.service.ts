// ─── Git Operations Service ─────────────────────────────────────────────────

import { join } from "path";
import { getConfig } from "../config";

export interface CloneOptions {
  repoUrl: string;
  targetDir: string;
  branch?: string;
  depth?: number;
}

export interface GitResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ─── Core Operations ────────────────────────────────────────────────────────

/**
 * Clone a git repository to the target directory.
 * On failure, cleans up any partial clone.
 */
export async function cloneRepo(options: CloneOptions): Promise<GitResult> {
  const { repoUrl, targetDir, branch, depth } = options;

  const args: string[] = ["clone"];

  if (branch) {
    args.push("--branch", branch);
  }

  if (depth) {
    args.push("--depth", String(depth));
  }

  args.push(repoUrl, targetDir);

  const result = await runGit(args);

  // Clean up on failure
  if (!result.success) {
    await cleanupDir(targetDir);
  }

  return result;
}

/**
 * Pull latest changes in an existing repo directory.
 */
export async function pullRepo(repoDir: string): Promise<GitResult> {
  return runGit(["pull", "--ff-only"], repoDir);
}

/**
 * Checkout a specific branch.
 */
export async function checkoutBranch(
  repoDir: string,
  branch: string
): Promise<GitResult> {
  return runGit(["checkout", branch], repoDir);
}

/**
 * Fetch latest refs without merging.
 */
export async function fetchRepo(repoDir: string): Promise<GitResult> {
  return runGit(["fetch", "--all"], repoDir);
}

/**
 * Get the current HEAD commit hash.
 */
export async function getHeadCommit(repoDir: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "HEAD"], repoDir);
  if (!result.success) return null;
  return result.stdout.trim();
}

/**
 * Get the latest commit message.
 */
export async function getCommitMessage(
  repoDir: string
): Promise<string | null> {
  const result = await runGit(
    ["log", "-1", "--pretty=format:%s"],
    repoDir
  );
  if (!result.success) return null;
  return result.stdout.trim();
}

/**
 * Get the apps directory path. Creates it if needed.
 */
export function getAppsDir(): string {
  const config = getConfig();
  return join(config.DATA_DIR, "apps");
}

/**
 * Get the repo directory for a given app.
 */
export function getAppRepoDir(appId: string): string {
  return join(getAppsDir(), appId, "repo");
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

async function runGit(
  args: string[],
  cwd?: string
): Promise<GitResult> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd: cwd || undefined,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        // Prevent git from prompting for credentials
        GIT_TERMINAL_PROMPT: "0",
      },
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    return {
      success: exitCode === 0,
      stdout,
      stderr,
      exitCode,
    };
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  }
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    const proc = Bun.spawn(["rm", "-rf", dir], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  } catch {
    // Best-effort cleanup
  }
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class GitError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(message);
    this.name = "GitError";
  }
}
