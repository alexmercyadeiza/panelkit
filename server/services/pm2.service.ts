// ─── PM2 Process Management Service ──────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PM2Process {
  name: string;
  pid: number | null;
  pm_id: number | null;
  status: string;
  cpu: number;
  memory: number;
  uptime: number | null;
  restarts: number;
  instances: number;
  exec_mode: string;
}

export interface PM2StartOptions {
  name: string;
  script: string;
  cwd?: string;
  args?: string[];
  env?: Record<string, string>;
  instances?: number;
  exec_mode?: "fork" | "cluster";
  max_memory_restart?: string;
  watch?: boolean;
  interpreter?: string;
}

export interface PM2LogOutput {
  out: string;
  err: string;
}

/**
 * Interface for PM2 operations.
 * Allows tests to mock all PM2 interactions.
 */
export interface PM2Executor {
  list(): Promise<PM2Process[]>;
  start(options: PM2StartOptions): Promise<PM2Process>;
  stop(name: string): Promise<void>;
  restart(name: string): Promise<void>;
  delete(name: string): Promise<void>;
  logs(name: string, lines?: number): Promise<PM2LogOutput>;
  describe(name: string): Promise<PM2Process | null>;
}

// ─── Default Executor (uses pm2 CLI via Bun.spawn) ──────────────────────────

async function pm2Command(
  args: string[],
  timeout: number = 30000
): Promise<string> {
  const proc = Bun.spawn(["pm2", ...args, "--no-color"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeout);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new PM2Error(
      `PM2 command failed (exit code ${exitCode}): ${stderr.trim()}`,
      500
    );
  }

  return await new Response(proc.stdout).text();
}

function parsePM2JsonList(json: string): PM2Process[] {
  try {
    const parsed = JSON.parse(json);

    if (!Array.isArray(parsed)) return [];

    return parsed.map((p: any) => ({
      name: p.name || "unknown",
      pid: p.pid ?? null,
      pm_id: p.pm_id ?? null,
      status: p.pm2_env?.status || p.status || "unknown",
      cpu: p.monit?.cpu ?? 0,
      memory: p.monit?.memory ?? 0,
      uptime: p.pm2_env?.pm_uptime ? Date.now() - p.pm2_env.pm_uptime : null,
      restarts: p.pm2_env?.restart_time ?? 0,
      instances: p.pm2_env?.instances ?? 1,
      exec_mode: p.pm2_env?.exec_mode || "fork_mode",
    }));
  } catch {
    return [];
  }
}

export const defaultPM2Executor: PM2Executor = {
  async list() {
    const output = await pm2Command(["jlist"]);
    return parsePM2JsonList(output);
  },

  async start(options) {
    const args: string[] = ["start", options.script, "--name", options.name];

    if (options.cwd) {
      args.push("--cwd", options.cwd);
    }

    if (options.instances && options.instances > 1) {
      args.push("-i", String(options.instances));
    }

    if (options.exec_mode === "cluster") {
      args.push("-i", String(options.instances || "max"));
    }

    if (options.max_memory_restart) {
      args.push("--max-memory-restart", options.max_memory_restart);
    }

    if (options.watch) {
      args.push("--watch");
    }

    if (options.interpreter) {
      args.push("--interpreter", options.interpreter);
    }

    if (options.args && options.args.length > 0) {
      args.push("--");
      args.push(...options.args);
    }

    // Set environment variables
    const envEntries = options.env ? Object.entries(options.env) : [];

    if (envEntries.length > 0) {
      // PM2 ecosystem file approach for env vars
      const ecosystem = {
        apps: [
          {
            name: options.name,
            script: options.script,
            cwd: options.cwd,
            instances: options.instances || 1,
            exec_mode: options.exec_mode || "fork",
            max_memory_restart: options.max_memory_restart,
            watch: options.watch || false,
            interpreter: options.interpreter,
            args: options.args?.join(" "),
            env: options.env,
          },
        ],
      };

      // Write temp ecosystem file and start from it
      const tmpFile = `/tmp/pm2-ecosystem-${options.name}-${Date.now()}.json`;
      await Bun.write(tmpFile, JSON.stringify(ecosystem));

      try {
        await pm2Command(["start", tmpFile]);
      } finally {
        try {
          const { unlinkSync } = await import("fs");
          unlinkSync(tmpFile);
        } catch {
          // Cleanup best effort
        }
      }
    } else {
      await pm2Command(args);
    }

    // Get the process info after starting
    const desc = await this.describe(options.name);
    if (desc) return desc;

    return {
      name: options.name,
      pid: null,
      pm_id: null,
      status: "online",
      cpu: 0,
      memory: 0,
      uptime: 0,
      restarts: 0,
      instances: options.instances || 1,
      exec_mode: options.exec_mode || "fork",
    };
  },

  async stop(name) {
    await pm2Command(["stop", name]);
  },

  async restart(name) {
    await pm2Command(["restart", name]);
  },

  async delete(name) {
    await pm2Command(["delete", name]);
  },

  async logs(name, lines = 100) {
    // PM2 logs are stored in ~/.pm2/logs/
    const outOutput = await pm2Command(["logs", name, "--out", "--nostream", "--lines", String(lines)]).catch(() => "");
    const errOutput = await pm2Command(["logs", name, "--err", "--nostream", "--lines", String(lines)]).catch(() => "");

    return {
      out: outOutput,
      err: errOutput,
    };
  },

  async describe(name) {
    try {
      const output = await pm2Command(["jlist"]);
      const processes = parsePM2JsonList(output);
      return processes.find((p) => p.name === name) || null;
    } catch {
      return null;
    }
  },
};

// ─── Service State ───────────────────────────────────────────────────────────

let _executor: PM2Executor = defaultPM2Executor;

/**
 * Set a custom PM2 executor (used for testing).
 */
export function setPM2Executor(executor: PM2Executor): void {
  _executor = executor;
}

/**
 * Reset to the default PM2 executor.
 */
export function resetPM2Executor(): void {
  _executor = defaultPM2Executor;
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * List all PM2 processes.
 */
export async function listProcesses(): Promise<PM2Process[]> {
  return _executor.list();
}

/**
 * Get details of a specific process.
 */
export async function getProcess(name: string): Promise<PM2Process | null> {
  return _executor.describe(name);
}

/**
 * Start a new PM2 process.
 */
export async function startProcess(
  options: PM2StartOptions
): Promise<PM2Process> {
  // Validate name
  if (!options.name || options.name.length === 0) {
    throw new PM2Error("Process name is required", 400);
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.name)) {
    throw new PM2Error(
      "Process name must be alphanumeric with dots, dashes, or underscores",
      400
    );
  }

  // Validate script
  if (!options.script || options.script.length === 0) {
    throw new PM2Error("Script path is required", 400);
  }

  // Validate instances
  if (options.instances !== undefined && options.instances < 1) {
    throw new PM2Error("Instances must be at least 1", 400);
  }

  // Check if process already exists
  const existing = await _executor.describe(options.name);
  if (existing) {
    throw new PM2Error(`Process "${options.name}" already exists`, 409);
  }

  return _executor.start(options);
}

/**
 * Stop a PM2 process.
 */
export async function stopProcess(name: string): Promise<void> {
  const proc = await _executor.describe(name);
  if (!proc) {
    throw new PM2Error(`Process "${name}" not found`, 404);
  }

  await _executor.stop(name);
}

/**
 * Restart a PM2 process.
 */
export async function restartProcess(name: string): Promise<void> {
  const proc = await _executor.describe(name);
  if (!proc) {
    throw new PM2Error(`Process "${name}" not found`, 404);
  }

  await _executor.restart(name);
}

/**
 * Delete a PM2 process.
 */
export async function deleteProcess(name: string): Promise<void> {
  const proc = await _executor.describe(name);
  if (!proc) {
    throw new PM2Error(`Process "${name}" not found`, 404);
  }

  await _executor.delete(name);
}

/**
 * Get logs for a PM2 process.
 */
export async function getProcessLogs(
  name: string,
  lines: number = 100
): Promise<PM2LogOutput> {
  const proc = await _executor.describe(name);
  if (!proc) {
    throw new PM2Error(`Process "${name}" not found`, 404);
  }

  return _executor.logs(name, lines);
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class PM2Error extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "PM2Error";
  }
}
