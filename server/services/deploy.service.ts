// ─── Deploy Orchestrator Service (PM2) ───────────────────────────────────────

import { eq, desc } from "drizzle-orm";
import { type AppDatabase, getDb } from "../db";
import { apps, deployments, appEnvVars } from "../db/schema";
import { generateId, decrypt, generateWebhookSecret } from "./crypto.service";
import {
  cloneRepo,
  pullRepo,
  fetchRepo,
  checkoutBranch,
  getHeadCommit,
  getCommitMessage,
  getAppRepoDir,
  getAppsDir,
} from "./git.service";
import { detectRuntime } from "../lib/buildpacks";
import { allocatePort, releasePort } from "../lib/port-manager";
import { getConfig } from "../config";
import { join } from "path";
import {
  getGitHubToken,
  getAuthenticatedCloneUrl,
} from "./github.service";

// ─── Deploy Queue (per-app mutex) ───────────────────────────────────────────

const deployLocks = new Map<string, Promise<DeployResult>>();

export interface DeployResult {
  success: boolean;
  deploymentId: string;
  processName?: string;
  port?: number;
  error?: string;
  buildLog?: string;
}

/**
 * Queue a deploy for an app. Uses a per-app mutex so only one deploy
 * runs at a time per app. Concurrent requests wait for the lock.
 */
export async function queueDeploy(
  appId: string,
  db?: AppDatabase
): Promise<DeployResult> {
  const database = db || getDb();

  // Wait for any in-progress deploy to finish, then start ours
  while (deployLocks.has(appId)) {
    try {
      await deployLocks.get(appId);
    } catch {
      // Previous deploy failed, proceed
    }
  }

  const deployPromise = executeDeploy(appId, database);
  deployLocks.set(appId, deployPromise);

  try {
    return await deployPromise;
  } finally {
    deployLocks.delete(appId);
  }
}

// ─── Pre-deploy Checks ─────────────────────────────────────────────────────

async function preDeployChecks(logs: string[]): Promise<void> {
  // Check node/npm/pm2 are available
  for (const bin of ["node", "npm", "pm2"]) {
    const result = await runShellCommand(`command -v ${bin}`, "/tmp");
    if (!result.success) {
      throw new DeployError(
        `Required binary '${bin}' not found. Run install.sh first.`,
        500
      );
    }
  }
  logs.push("[deploy] Pre-checks: node, npm, pm2 available");

  // Check disk space (need at least 500MB free)
  const dfResult = await runShellCommand(
    "df -BM / | awk 'NR==2 {print $4}' | sed 's/M//'",
    "/tmp"
  );
  if (dfResult.success) {
    const freeMB = parseInt(dfResult.stdout.trim(), 10);
    if (!isNaN(freeMB) && freeMB < 500) {
      throw new DeployError(
        `Insufficient disk space: ${freeMB}MB free, need at least 500MB`,
        500
      );
    }
    logs.push(`[deploy] Pre-checks: ${freeMB}MB disk space available`);
  }
}

// ─── Full Deploy Pipeline ───────────────────────────────────────────────────

async function executeDeploy(
  appId: string,
  db: AppDatabase
): Promise<DeployResult> {
  const deploymentId = generateId();
  const now = new Date().toISOString();
  const logs: string[] = [];

  // Flush logs to DB so the dashboard can poll them in real-time
  async function flushLog() {
    await db
      .update(deployments)
      .set({ buildLog: logs.join("\n") })
      .where(eq(deployments.id, deploymentId));
  }

  // Create deployment record
  await db.insert(deployments).values({
    id: deploymentId,
    appId,
    status: "pending",
    startedAt: now,
    createdAt: now,
  });

  try {
    // 1. Get app config
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new DeployError("App not found", 404);
    }

    logs.push(`[deploy] Starting deployment for ${app.name}`);

    // Pre-deploy checks: verify node/npm/pm2 + disk space
    await preDeployChecks(logs);
    await flushLog();

    // Update app status
    await db
      .update(apps)
      .set({ status: "building", updatedAt: new Date().toISOString() })
      .where(eq(apps.id, appId));

    await db
      .update(deployments)
      .set({ status: "building" })
      .where(eq(deployments.id, deploymentId));

    // 2. Clone or pull repo
    const repoDir = getAppRepoDir(appId);
    logs.push(`[deploy] Repo dir: ${repoDir}`);

    // Resolve clone URL — inject GitHub token for github.com URLs if available
    let effectiveRepoUrl = app.repoUrl;
    const isGitHubUrl = app.repoUrl.includes("github.com");

    if (isGitHubUrl) {
      try {
        const ghToken = await getGitHubToken(db);
        if (ghToken) {
          effectiveRepoUrl = getAuthenticatedCloneUrl(app.repoUrl, ghToken);
          logs.push("[deploy] Using authenticated GitHub clone URL");
        }
      } catch {
        // Proceed without token — will work for public repos
        logs.push("[deploy] No GitHub token available, using unauthenticated clone");
      }
    }

    // Ensure apps directory exists
    const appsDir = getAppsDir();
    await ensureDir(appsDir);
    await ensureDir(join(appsDir, appId));

    const repoExists = await dirExists(join(repoDir, ".git"));

    let cloneNeeded = !repoExists;

    if (repoExists) {
      // Persist authenticated remote URL so future pulls work
      if (effectiveRepoUrl !== app.repoUrl) {
        await runShellCommand(
          `git remote set-url origin '${effectiveRepoUrl}'`,
          repoDir
        );
        logs.push("[deploy] Updated remote URL with auth token");
      }

      // Fetch + checkout branch before pulling
      logs.push(`[deploy] Fetching latest refs...`);
      const fetchResult = await fetchRepo(repoDir);
      if (!fetchResult.success) {
        logs.push(`[deploy] Fetch failed: ${fetchResult.stderr}`);
      }

      if (app.branch) {
        logs.push(`[deploy] Checking out branch: ${app.branch}`);
        const checkoutResult = await checkoutBranch(repoDir, app.branch);
        if (!checkoutResult.success) {
          logs.push(`[deploy] Checkout failed: ${checkoutResult.stderr}`);
        }
      }

      logs.push("[deploy] Pulling latest changes...");
      const pullResult = await pullRepo(repoDir);
      if (!pullResult.success) {
        logs.push(`[deploy] Pull failed: ${pullResult.stderr}, will re-clone`);
        cloneNeeded = true;
      } else {
        logs.push("[deploy] Pull completed");
      }
    }

    if (cloneNeeded) {
      // Always nuke the repo dir before cloning — handles partial clones,
      // broken .git dirs, leftover dirs from previous failed deploys
      logs.push("[deploy] Removing old repo directory...");
      await cleanupDir(repoDir);

      logs.push("[deploy] Cloning repository...");
      const cloneResult = await cloneRepo({
        repoUrl: effectiveRepoUrl,
        targetDir: repoDir,
        branch: app.branch,
        depth: 1,
      });
      if (!cloneResult.success) {
        throw new DeployError(
          `Clone failed: ${cloneResult.stderr}`,
          500
        );
      }
      logs.push("[deploy] Clone completed");
    }
    await flushLog();

    // 3. Get commit info
    const commitHash = await getHeadCommit(repoDir);
    const commitMessage = await getCommitMessage(repoDir);

    await db
      .update(deployments)
      .set({
        commitHash,
        commitMessage,
        branch: app.branch,
      })
      .where(eq(deployments.id, deploymentId));

    logs.push(`[deploy] Commit: ${commitHash?.substring(0, 8)} — ${commitMessage}`);

    // 4. Detect runtime
    const detection = await detectRuntime(repoDir);
    logs.push(
      `[deploy] Detected: ${detection.framework} (runtime: ${detection.runtime}, via ${detection.detectedBy})`
    );

    if (detection.runtime === "unknown") {
      throw new DeployError(
        "Could not detect runtime. Add a package.json or index.html.",
        400
      );
    }

    // Use app-level overrides if set, otherwise use detected commands
    const installCommand = detection.installCommand;
    const buildCommand = app.buildCommand || detection.buildCommand;
    const startCommand = app.startCommand || detection.startCommand;

    if (!startCommand) {
      throw new DeployError(
        "Could not determine start command for the detected runtime.",
        400
      );
    }

    // 5. Clean deploy — remove node_modules + build output dirs before install
    const dirsToClean = ["node_modules", ...detection.buildOutputDirs];
    for (const d of dirsToClean) {
      const dirPath = join(repoDir, d);
      if (await dirExists(dirPath)) {
        logs.push(`[deploy] Cleaning ${d}...`);
        await cleanupDir(dirPath);
      }
    }

    // 6. Decrypt env vars early — needed for both build and start steps
    //    (e.g. Next.js evaluates API routes at build time, needs API keys)
    const envRows = await db.query.appEnvVars.findMany({
      where: eq(appEnvVars.appId, appId),
    });

    const envVars: Record<string, string> = {};
    for (const row of envRows) {
      try {
        envVars[row.key] = await decrypt(row.encryptedValue);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new DeployError(
          `Failed to decrypt env var '${row.key}': ${msg}`,
          500
        );
      }
    }

    if (Object.keys(envVars).length > 0) {
      logs.push(`[deploy] Loaded ${Object.keys(envVars).length} env var(s)`);
    }

    // 7. Install dependencies
    if (installCommand) {
      logs.push(`[deploy] Installing dependencies: ${installCommand}`);

      await db
        .update(deployments)
        .set({ status: "building" })
        .where(eq(deployments.id, deploymentId));

      const installResult = await runShellCommand(installCommand, repoDir, envVars);

      if (!installResult.success) {
        logs.push(`[deploy] Install failed: ${installResult.stderr}`);
        throw new DeployError(
          `Dependency install failed: ${installResult.stderr}`,
          500
        );
      }

      logs.push("[deploy] Dependencies installed");
    }
    await flushLog();

    // 8. Build step — env vars are passed so frameworks can access them at build time
    if (buildCommand) {
      logs.push(`[deploy] Building: ${buildCommand}`);

      const buildResult = await runShellCommand(buildCommand, repoDir, envVars);

      if (!buildResult.success) {
        logs.push(`[deploy] Build failed: ${buildResult.stderr}`);
        throw new DeployError(
          `Build failed: ${buildResult.stderr}`,
          500
        );
      }

      logs.push("[deploy] Build completed");

      // Validate build output dirs exist after build
      for (const d of detection.buildOutputDirs) {
        if (!(await dirExists(join(repoDir, d)))) {
          logs.push(`[deploy] WARNING: Expected build output dir '${d}' not found after build`);
        }
      }
    }
    await flushLog();

    await db
      .update(deployments)
      .set({ status: "deploying" })
      .where(eq(deployments.id, deploymentId));

    // 9. Allocate port
    let port = app.port;
    if (!port) {
      port = await allocatePort(appId, db);
      logs.push(`[deploy] Allocated port ${port}`);
    }

    // Add PORT env var so the app knows which port to listen on
    envVars.PORT = String(port);

    // Resolve $PORT in start command
    const resolvedStartCommand = startCommand.replace(/\$PORT/g, String(port));

    // 10. Validate start command — if it references `node X`, check file exists
    await validateStartCommand(resolvedStartCommand, repoDir, logs);

    // 11. PM2 process name
    const processName = `panelkit-${app.name}`;
    const oldProcessName = app.containerId; // repurposed from containerId

    // 12. Stop old PM2 process if exists
    if (oldProcessName) {
      logs.push(`[deploy] Stopping old process ${oldProcessName}...`);
      await pm2Delete(oldProcessName);
      logs.push("[deploy] Old process stopped");
    }

    // 13. Start new PM2 process
    logs.push(`[deploy] Starting PM2 process ${processName}...`);

    const pm2Result = await pm2Start({
      name: processName,
      script: resolvedStartCommand,
      cwd: repoDir,
      env: envVars,
    });

    if (!pm2Result.success) {
      logs.push(`[deploy] PM2 start failed: ${pm2Result.stderr}`);
      throw new DeployError(
        `PM2 start failed: ${pm2Result.stderr}`,
        500
      );
    }

    logs.push("[deploy] PM2 process started");
    await flushLog();

    // 14. Health check — 60s timeout, 2s interval, 200-399 = healthy
    logs.push("[deploy] Running health check...");
    await flushLog();
    const healthy = await waitForHealthy(port, 60000);

    if (!healthy) {
      logs.push("[deploy] Health check failed, rolling back...");
      await pm2Delete(processName);
      throw new DeployError("Health check failed after 60s", 500);
    }

    logs.push("[deploy] Health check passed");

    // 15. Update app and deployment records
    const finishedAt = new Date().toISOString();

    await db
      .update(apps)
      .set({
        status: "running",
        containerId: processName, // repurposed as PM2 process name
        port,
        runtime: detection.runtime,
        currentDeploymentId: deploymentId,
        updatedAt: finishedAt,
      })
      .where(eq(apps.id, appId));

    await db
      .update(deployments)
      .set({
        status: "running",
        containerId: processName,
        finishedAt,
        buildLog: logs.join("\n"),
      })
      .where(eq(deployments.id, deploymentId));

    logs.push("[deploy] Deployment complete!");

    return {
      success: true,
      deploymentId,
      processName,
      port,
      buildLog: logs.join("\n"),
    };
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : String(error);
    logs.push(`[deploy] ERROR: ${errorMsg}`);

    const finishedAt = new Date().toISOString();

    await db
      .update(apps)
      .set({ status: "failed", updatedAt: finishedAt })
      .where(eq(apps.id, appId));

    await db
      .update(deployments)
      .set({
        status: "failed",
        finishedAt,
        buildLog: logs.join("\n"),
      })
      .where(eq(deployments.id, deploymentId));

    return {
      success: false,
      deploymentId,
      error: errorMsg,
      buildLog: logs.join("\n"),
    };
  }
}

// ─── Start Command Validation ───────────────────────────────────────────────

async function validateStartCommand(
  startCommand: string,
  repoDir: string,
  logs: string[]
): Promise<void> {
  // Check if command is `node <file>` and verify the file exists
  const nodeFileMatch = startCommand.match(/^node\s+([^\s]+)/);
  if (nodeFileMatch) {
    const filePath = join(repoDir, nodeFileMatch[1]);
    if (!(await fileExists(filePath))) {
      throw new DeployError(
        `Start command references '${nodeFileMatch[1]}' but it does not exist after build`,
        500
      );
    }
    logs.push(`[deploy] Validated start file: ${nodeFileMatch[1]}`);
  }
}

// ─── Rollback ───────────────────────────────────────────────────────────────

/**
 * Rollback to a previous deployment by re-deploying from the repo
 * at the target commit.
 */
export async function rollback(
  appId: string,
  targetDeploymentId?: string,
  db?: AppDatabase
): Promise<DeployResult> {
  const database = db || getDb();
  const deploymentId = generateId();
  const now = new Date().toISOString();
  const logs: string[] = [];

  const app = await database.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new DeployError("App not found", 404);
  }

  // Find the target deployment to rollback to
  let targetDeploy;

  if (targetDeploymentId) {
    targetDeploy = await database.query.deployments.findFirst({
      where: eq(deployments.id, targetDeploymentId),
    });
  } else {
    // Find the most recent successful deployment before the current one
    const previousDeploys = await database
      .select()
      .from(deployments)
      .where(eq(deployments.appId, appId))
      .orderBy(desc(deployments.createdAt))
      .limit(10);

    targetDeploy = previousDeploys.find(
      (d) =>
        d.status === "running" &&
        d.id !== app.currentDeploymentId &&
        d.commitHash
    );
  }

  if (!targetDeploy || !targetDeploy.commitHash) {
    throw new DeployError("No previous deployment found to rollback to", 404);
  }

  // Create rollback deployment record
  await database.insert(deployments).values({
    id: deploymentId,
    appId,
    commitHash: targetDeploy.commitHash,
    commitMessage: `Rollback to ${targetDeploy.id.substring(0, 8)}`,
    branch: targetDeploy.branch,
    status: "deploying",
    startedAt: now,
    createdAt: now,
  });

  try {
    // Mark current deployment as rolled back
    if (app.currentDeploymentId) {
      await database
        .update(deployments)
        .set({ status: "rolled_back" })
        .where(eq(deployments.id, app.currentDeploymentId));
    }

    // Checkout the target commit in the repo
    const repoDir = getAppRepoDir(appId);
    logs.push(`[rollback] Checking out commit ${targetDeploy.commitHash?.substring(0, 8)}`);

    if (targetDeploy.commitHash) {
      await runShellCommand(`git checkout ${targetDeploy.commitHash}`, repoDir);
    }

    // Detect runtime and get proper commands
    const detection = await detectRuntime(repoDir);
    logs.push(
      `[rollback] Detected: ${detection.framework} (runtime: ${detection.runtime})`
    );

    // FIX: use detection.installCommand, not app.buildCommand
    const installCommand = detection.installCommand;
    const buildCommand = app.buildCommand || detection.buildCommand;
    const startCommand = app.startCommand || detection.startCommand;

    // Decrypt env vars early — needed for build step
    const envRows = await database.query.appEnvVars.findMany({
      where: eq(appEnvVars.appId, appId),
    });

    const envVars: Record<string, string> = {};
    for (const row of envRows) {
      try {
        envVars[row.key] = await decrypt(row.encryptedValue);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new DeployError(
          `Failed to decrypt env var '${row.key}': ${msg}`,
          500
        );
      }
    }

    // Clean node_modules + build output dirs for clean rollback
    const dirsToClean = ["node_modules", ...detection.buildOutputDirs];
    for (const d of dirsToClean) {
      const dirPath = join(repoDir, d);
      if (await dirExists(dirPath)) {
        logs.push(`[rollback] Cleaning ${d}...`);
        await cleanupDir(dirPath);
      }
    }

    // Install dependencies
    if (installCommand) {
      logs.push(`[rollback] Installing: ${installCommand}`);
      const installResult = await runShellCommand(installCommand, repoDir, envVars);
      if (!installResult.success) {
        throw new DeployError(
          `Rollback install failed: ${installResult.stderr}`,
          500
        );
      }
    }

    // Build step
    if (buildCommand) {
      logs.push(`[rollback] Building: ${buildCommand}`);
      const buildResult = await runShellCommand(buildCommand, repoDir, envVars);
      if (!buildResult.success) {
        throw new DeployError(
          `Rollback build failed: ${buildResult.stderr}`,
          500
        );
      }

      // Validate build output dirs exist after build
      for (const d of detection.buildOutputDirs) {
        if (!(await dirExists(join(repoDir, d)))) {
          throw new DeployError(
            `Rollback build output dir '${d}' not found after build`,
            500
          );
        }
      }
    }

    const port = app.port;
    if (!port) {
      throw new DeployError("App has no allocated port", 500);
    }

    envVars.PORT = String(port);

    // Resolve $PORT in start command
    const resolvedStartCommand = (startCommand || "npm start").replace(
      /\$PORT/g,
      String(port)
    );

    const processName = `panelkit-${app.name}`;

    // Stop current PM2 process
    if (app.containerId) {
      await pm2Delete(app.containerId);
    }

    // Start new PM2 process
    logs.push(`[rollback] Starting PM2 process ${processName}...`);
    const pm2Result = await pm2Start({
      name: processName,
      script: resolvedStartCommand,
      cwd: repoDir,
      env: envVars,
    });

    if (!pm2Result.success) {
      throw new DeployError(
        `Rollback PM2 start failed: ${pm2Result.stderr}`,
        500
      );
    }

    // Health check — 60s timeout, 2s interval, 200-399 healthy
    logs.push("[rollback] Running health check...");
    const healthy = await waitForHealthy(port, 60000);

    if (!healthy) {
      await pm2Delete(processName);
      throw new DeployError("Rollback health check failed after 60s", 500);
    }

    const finishedAt = new Date().toISOString();

    // Update records
    await database
      .update(apps)
      .set({
        status: "running",
        containerId: processName,
        currentDeploymentId: deploymentId,
        updatedAt: finishedAt,
      })
      .where(eq(apps.id, appId));

    await database
      .update(deployments)
      .set({
        status: "running",
        containerId: processName,
        finishedAt,
        buildLog: logs.join("\n"),
      })
      .where(eq(deployments.id, deploymentId));

    return {
      success: true,
      deploymentId,
      processName,
      port,
      buildLog: logs.join("\n"),
    };
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : String(error);
    logs.push(`[rollback] ERROR: ${errorMsg}`);

    await database
      .update(deployments)
      .set({
        status: "failed",
        finishedAt: new Date().toISOString(),
        buildLog: logs.join("\n"),
      })
      .where(eq(deployments.id, deploymentId));

    return {
      success: false,
      deploymentId,
      error: errorMsg,
      buildLog: logs.join("\n"),
    };
  }
}

// ─── Webhook Validation ─────────────────────────────────────────────────────

/**
 * Validate a GitHub webhook HMAC signature.
 */
export async function validateWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!signature.startsWith("sha256=")) {
    return false;
  }

  const sigHex = signature.substring(7);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  const expected = Buffer.from(new Uint8Array(mac)).toString("hex");

  // Timing-safe comparison
  if (expected.length !== sigHex.length) return false;

  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ sigHex.charCodeAt(i);
  }

  return result === 0;
}

// ─── PM2 Helpers ─────────────────────────────────────────────────────────────

interface PM2StartConfig {
  name: string;
  script: string;
  cwd: string;
  env: Record<string, string>;
}

interface ShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Start a PM2 process using an ecosystem file for env var support.
 * Uses `interpreter: 'bun'` for .ts scripts.
 */
async function pm2Start(config: PM2StartConfig): Promise<ShellResult> {
  // Determine if we need bun as interpreter for TypeScript
  const needsBunInterpreter = config.script.endsWith(".ts");

  const appConfig: Record<string, any> = {
    name: config.name,
    script: config.script,
    cwd: config.cwd,
    env: config.env,
    autorestart: true,
    max_restarts: 10,
  };

  if (needsBunInterpreter) {
    appConfig.interpreter = "bun";
  }

  const ecosystem = { apps: [appConfig] };

  const ecosystemPath = join(
    config.cwd,
    `ecosystem.panelkit.json`
  );

  try {
    await Bun.write(ecosystemPath, JSON.stringify(ecosystem, null, 2));

    const proc = Bun.spawn(["pm2", "start", ecosystemPath], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: config.cwd,
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
    };
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Delete (stop and remove) a PM2 process. Best-effort — does not throw.
 */
async function pm2Delete(processName: string): Promise<void> {
  try {
    const proc = Bun.spawn(["pm2", "delete", processName], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  } catch {
    // Best effort
  }
}

// ─── Shell Helpers ───────────────────────────────────────────────────────────

/**
 * Run a shell command in a given directory, optionally with extra env vars.
 */
async function runShellCommand(
  command: string,
  cwd: string,
  env?: Record<string, string>
): Promise<ShellResult> {
  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
      cwd,
      env: env ? { ...process.env, ...env } : undefined,
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
    };
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForHealthy(
  port: number,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  const interval = 2000; // 2s interval (was 1s)

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      // Only 200-399 is healthy (was <500)
      if (response.status >= 200 && response.status < 400) {
        return true;
      }
    } catch {
      // Not ready yet
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  return false;
}

async function ensureDir(dir: string): Promise<void> {
  try {
    const proc = Bun.spawn(["mkdir", "-p", dir], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
  } catch {
    // Best effort
  }
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    const file = Bun.file(dir);
    return await file.exists();
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
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
    // Best effort
  }
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class DeployError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "DeployError";
  }
}
