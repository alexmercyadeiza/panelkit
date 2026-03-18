// ─── Docker Service (Bun.spawn wrapper) ─────────────────────────────────────

export interface BuildOptions {
  contextDir: string;
  imageName: string;
  tag?: string;
  dockerfilePath?: string;
  buildArgs?: Record<string, string>;
}

export interface ContainerOptions {
  imageName: string;
  containerName: string;
  port?: { host: number; container: number };
  envVars?: Record<string, string>;
  restart?: "no" | "always" | "unless-stopped" | "on-failure";
  detach?: boolean;
}

export interface DockerResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type ContainerStatus =
  | "running"
  | "exited"
  | "paused"
  | "restarting"
  | "dead"
  | "created"
  | "removing"
  | "not_found";

// ─── Image Operations ───────────────────────────────────────────────────────

/**
 * Build a Docker image from a directory.
 */
export async function buildImage(options: BuildOptions): Promise<DockerResult> {
  const { contextDir, imageName, tag, dockerfilePath, buildArgs } = options;
  const fullTag = tag ? `${imageName}:${tag}` : `${imageName}:latest`;

  const args: string[] = ["build", "-t", fullTag];

  if (dockerfilePath) {
    args.push("-f", dockerfilePath);
  }

  if (buildArgs) {
    for (const [key, value] of Object.entries(buildArgs)) {
      args.push("--build-arg", `${key}=${value}`);
    }
  }

  args.push(contextDir);

  return runDocker(args);
}

/**
 * Remove a Docker image.
 */
export async function removeImage(imageName: string): Promise<DockerResult> {
  return runDocker(["rmi", "-f", imageName]);
}

// ─── Container Operations ───────────────────────────────────────────────────

/**
 * Create and start a container.
 */
export async function createContainer(
  options: ContainerOptions
): Promise<DockerResult> {
  const { imageName, containerName, port, envVars, restart, detach } = options;

  const args: string[] = ["run"];

  if (detach !== false) {
    args.push("-d");
  }

  args.push("--name", containerName);

  if (port) {
    args.push("-p", `${port.host}:${port.container}`);
  }

  if (envVars) {
    for (const [key, value] of Object.entries(envVars)) {
      args.push("-e", `${key}=${value}`);
    }
  }

  if (restart) {
    args.push("--restart", restart);
  }

  args.push(imageName);

  const result = await runDocker(args);

  // The stdout of `docker run -d` is the container ID
  if (result.success) {
    result.stdout = result.stdout.trim();
  }

  return result;
}

/**
 * Start a stopped container.
 */
export async function startContainer(
  containerName: string
): Promise<DockerResult> {
  return runDocker(["start", containerName]);
}

/**
 * Stop a running container.
 */
export async function stopContainer(
  containerName: string,
  timeout: number = 10
): Promise<DockerResult> {
  return runDocker(["stop", "-t", String(timeout), containerName]);
}

/**
 * Remove a container (force).
 */
export async function removeContainer(
  containerName: string
): Promise<DockerResult> {
  return runDocker(["rm", "-f", containerName]);
}

/**
 * Get container logs.
 */
export async function getContainerLogs(
  containerName: string,
  options?: { tail?: number; since?: string }
): Promise<DockerResult> {
  const args: string[] = ["logs"];

  if (options?.tail) {
    args.push("--tail", String(options.tail));
  }

  if (options?.since) {
    args.push("--since", options.since);
  }

  args.push(containerName);

  return runDocker(args);
}

/**
 * Get the status of a container.
 */
export async function getContainerStatus(
  containerName: string
): Promise<ContainerStatus> {
  const result = await runDocker([
    "inspect",
    "--format",
    "{{.State.Status}}",
    containerName,
  ]);

  if (!result.success) {
    return "not_found";
  }

  const status = result.stdout.trim() as ContainerStatus;
  return status;
}

/**
 * Inspect a container and return JSON metadata.
 */
export async function inspectContainer(
  containerName: string
): Promise<Record<string, unknown> | null> {
  const result = await runDocker(["inspect", containerName]);

  if (!result.success) return null;

  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return null;
  }
}

/**
 * List running containers (optionally filtered by label or name).
 */
export async function listContainers(
  filter?: string
): Promise<DockerResult> {
  const args: string[] = ["ps", "--format", "{{json .}}"];

  if (filter) {
    args.push("--filter", filter);
  }

  return runDocker(args);
}

/**
 * Check if Docker daemon is available.
 */
export async function isDockerAvailable(): Promise<boolean> {
  const result = await runDocker(["info"]);
  return result.success;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

async function runDocker(
  args: string[],
  options?: { timeout?: number }
): Promise<DockerResult> {
  try {
    const proc = Bun.spawn(["docker", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (options?.timeout) {
      timeoutId = setTimeout(() => {
        proc.kill();
      }, options.timeout);
    }

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    if (timeoutId) clearTimeout(timeoutId);

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

// ─── Error Class ─────────────────────────────────────────────────────────────

export class DockerError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(message);
    this.name = "DockerError";
  }
}
