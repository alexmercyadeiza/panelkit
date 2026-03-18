// ─── Deploy Orchestrator Service ─────────────────────────────────────────────

import { eq, desc } from "drizzle-orm";
import { type AppDatabase, getDb } from "../db";
import { apps, deployments, appEnvVars } from "../db/schema";
import { generateId, decrypt, generateWebhookSecret } from "./crypto.service";
import {
  cloneRepo,
  pullRepo,
  getHeadCommit,
  getCommitMessage,
  getAppRepoDir,
  getAppsDir,
} from "./git.service";
import {
  buildImage,
  createContainer,
  stopContainer,
  removeContainer,
  getContainerStatus,
} from "./docker.service";
import { detectRuntime } from "../lib/buildpacks";
import { allocatePort, releasePort } from "../lib/port-manager";
import { getConfig } from "../config";
import { join } from "path";

// ─── Deploy Queue ───────────────────────────────────────────────────────────

const deployQueues = new Map<string, Promise<DeployResult>>();

export interface DeployResult {
  success: boolean;
  deploymentId: string;
  containerId?: string;
  port?: number;
  error?: string;
  buildLog?: string;
}

/**
 * Queue a deploy for an app. If a deploy is already in progress for
 * the same app, the new one waits for it to finish first.
 */
export async function queueDeploy(
  appId: string,
  db?: AppDatabase
): Promise<DeployResult> {
  const database = db || getDb();
  const existing = deployQueues.get(appId);

  const deployPromise = (async () => {
    // Wait for any in-progress deploy to finish
    if (existing) {
      try {
        await existing;
      } catch {
        // Previous deploy failed, proceed with ours
      }
    }

    return executeDeploy(appId, database);
  })();

  deployQueues.set(appId, deployPromise);

  try {
    return await deployPromise;
  } finally {
    // Clean up queue entry only if this is still the latest
    if (deployQueues.get(appId) === deployPromise) {
      deployQueues.delete(appId);
    }
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

    // Ensure apps directory exists
    const appsDir = getAppsDir();
    await ensureDir(appsDir);
    await ensureDir(join(appsDir, appId));

    const repoExists = await dirExists(join(repoDir, ".git"));

    if (repoExists) {
      logs.push("[deploy] Pulling latest changes...");
      const pullResult = await pullRepo(repoDir);
      if (!pullResult.success) {
        logs.push(`[deploy] Pull failed: ${pullResult.stderr}`);
        // Try fresh clone
        await cleanupDir(repoDir);
        const cloneResult = await cloneRepo({
          repoUrl: app.repoUrl,
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
        logs.push("[deploy] Fresh clone completed");
      } else {
        logs.push("[deploy] Pull completed");
      }
    } else {
      logs.push("[deploy] Cloning repository...");
      const cloneResult = await cloneRepo({
        repoUrl: app.repoUrl,
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

    // 4. Detect runtime & generate Dockerfile
    const detection = await detectRuntime(repoDir);
    logs.push(`[deploy] Runtime detected: ${detection.runtime} (via ${detection.detectedBy})`);

    if (detection.runtime === "unknown") {
      throw new DeployError(
        "Could not detect runtime. Add a Dockerfile or supported project file.",
        400
      );
    }

    // Write generated Dockerfile if needed
    if (detection.dockerfile && detection.runtime !== "dockerfile") {
      const dockerfilePath = join(repoDir, "Dockerfile.panelkit");
      await Bun.write(dockerfilePath, detection.dockerfile);
      logs.push("[deploy] Generated Dockerfile.panelkit");
    }

    // 5. Build Docker image
    const imageName = `panelkit-${app.name}`;
    const imageTag = commitHash?.substring(0, 8) || deploymentId.substring(0, 8);
    const dockerfilePath =
      app.dockerfilePath ||
      (detection.runtime === "dockerfile"
        ? join(repoDir, "Dockerfile")
        : join(repoDir, "Dockerfile.panelkit"));

    logs.push(`[deploy] Building image ${imageName}:${imageTag}...`);

    const buildResult = await buildImage({
      contextDir: repoDir,
      imageName,
      tag: imageTag,
      dockerfilePath,
    });

    if (!buildResult.success) {
      logs.push(`[deploy] Build failed: ${buildResult.stderr}`);
      throw new DeployError(`Build failed: ${buildResult.stderr}`, 500);
    }

    logs.push("[deploy] Build completed");

    await db
      .update(deployments)
      .set({
        status: "deploying",
        imageId: `${imageName}:${imageTag}`,
      })
      .where(eq(deployments.id, deploymentId));

    // 6. Get env vars
    const envRows = await db.query.appEnvVars.findMany({
      where: eq(appEnvVars.appId, appId),
    });

    const envVars: Record<string, string> = {};
    for (const row of envRows) {
      try {
        envVars[row.key] = await decrypt(row.encryptedValue);
      } catch {
        logs.push(`[deploy] Warning: Could not decrypt env var ${row.key}`);
      }
    }

    // 7. Blue-green: keep old container running
    const oldContainerName = app.containerId;
    const containerName = `panelkit-${app.name}-${imageTag}`;

    // Allocate port
    let port = app.port;
    if (!port) {
      port = await allocatePort(appId, db);
      logs.push(`[deploy] Allocated port ${port}`);
    }

    // Determine container port based on runtime
    const containerPort = getContainerPort(detection.runtime);

    // 8. Start new container
    logs.push(`[deploy] Starting container ${containerName}...`);

    // Add PORT env var so the app knows which port to listen on
    envVars.PORT = String(containerPort);

    const runResult = await createContainer({
      imageName: `${imageName}:${imageTag}`,
      containerName,
      port: { host: port, container: containerPort },
      envVars,
      restart: "unless-stopped",
    });

    if (!runResult.success) {
      logs.push(`[deploy] Container start failed: ${runResult.stderr}`);
      throw new DeployError(
        `Container start failed: ${runResult.stderr}`,
        500
      );
    }

    const containerId = runResult.stdout;
    logs.push(`[deploy] Container started: ${containerId.substring(0, 12)}`);

    // 9. Health check
    logs.push("[deploy] Running health check...");
    const healthy = await waitForHealthy(port, 30000);

    if (!healthy) {
      logs.push("[deploy] Health check failed, rolling back...");
      await stopContainer(containerName);
      await removeContainer(containerName);
      throw new DeployError("Health check failed after 30s", 500);
    }

    logs.push("[deploy] Health check passed");

    // 10. Remove old container (blue-green swap)
    if (oldContainerName && oldContainerName !== containerName) {
      logs.push(`[deploy] Removing old container ${oldContainerName}...`);
      await stopContainer(oldContainerName, 5);
      await removeContainer(oldContainerName);
      logs.push("[deploy] Old container removed");
    }

    // 11. Update app and deployment records
    const finishedAt = new Date().toISOString();

    await db
      .update(apps)
      .set({
        status: "running",
        containerId: containerName,
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
        containerId: containerName,
        finishedAt,
        buildLog: logs.join("\n"),
      })
      .where(eq(deployments.id, deploymentId));

    logs.push("[deploy] Deployment complete!");

    return {
      success: true,
      deploymentId,
      containerId: containerName,
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

// ─── Rollback ───────────────────────────────────────────────────────────────

/**
 * Rollback to a previous deployment.
 */
export async function rollback(
  appId: string,
  targetDeploymentId?: string,
  db?: AppDatabase
): Promise<DeployResult> {
  const database = db || getDb();
  const deploymentId = generateId();
  const now = new Date().toISOString();

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
        d.imageId
    );
  }

  if (!targetDeploy || !targetDeploy.imageId) {
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
    imageId: targetDeploy.imageId,
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

    // Get env vars
    const envRows = await database.query.appEnvVars.findMany({
      where: eq(appEnvVars.appId, appId),
    });

    const envVars: Record<string, string> = {};
    for (const row of envRows) {
      try {
        envVars[row.key] = await decrypt(row.encryptedValue);
      } catch {
        // Skip vars that can't be decrypted
      }
    }

    const port = app.port;
    if (!port) {
      throw new DeployError("App has no allocated port", 500);
    }

    const containerPort = getContainerPort(app.runtime || "nodejs");
    envVars.PORT = String(containerPort);

    const containerName = `panelkit-${app.name}-rollback-${deploymentId.substring(0, 8)}`;

    // Start new container from old image
    const runResult = await createContainer({
      imageName: targetDeploy.imageId,
      containerName,
      port: { host: port, container: containerPort },
      envVars,
      restart: "unless-stopped",
    });

    if (!runResult.success) {
      throw new DeployError(
        `Rollback container start failed: ${runResult.stderr}`,
        500
      );
    }

    // Health check
    const healthy = await waitForHealthy(port, 30000);

    if (!healthy) {
      await stopContainer(containerName);
      await removeContainer(containerName);
      throw new DeployError("Rollback health check failed", 500);
    }

    // Remove current container
    if (app.containerId) {
      await stopContainer(app.containerId, 5);
      await removeContainer(app.containerId);
    }

    const finishedAt = new Date().toISOString();

    // Update records
    await database
      .update(apps)
      .set({
        status: "running",
        containerId: containerName,
        currentDeploymentId: deploymentId,
        updatedAt: finishedAt,
      })
      .where(eq(apps.id, appId));

    await database
      .update(deployments)
      .set({
        status: "running",
        containerId: containerName,
        finishedAt,
      })
      .where(eq(deployments.id, deploymentId));

    return {
      success: true,
      deploymentId,
      containerId: containerName,
      port,
    };
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : String(error);

    await database
      .update(deployments)
      .set({
        status: "failed",
        finishedAt: new Date().toISOString(),
        buildLog: `Rollback failed: ${errorMsg}`,
      })
      .where(eq(deployments.id, deploymentId));

    return {
      success: false,
      deploymentId,
      error: errorMsg,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getContainerPort(runtime: string): number {
  switch (runtime) {
    case "nodejs":
      return 3000;
    case "python":
      return 8000;
    case "go":
      return 8080;
    case "php":
    case "static":
      return 80;
    default:
      return 3000;
  }
}

async function waitForHealthy(
  port: number,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  const interval = 1000;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      // Any response (even 404) means the server is up
      if (response.status < 500) {
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
