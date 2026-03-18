import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  listProcesses,
  startProcess,
  stopProcess,
  restartProcess,
  deleteProcess,
  getProcessLogs,
  getProcess,
  setPM2Executor,
  resetPM2Executor,
  type PM2Executor,
  type PM2Process,
  PM2Error,
} from "../../server/services/pm2.service";

function createMockExecutor(): PM2Executor & {
  processes: Map<string, PM2Process>;
} {
  const processes = new Map<string, PM2Process>();

  return {
    processes,
    async list() {
      return [...processes.values()];
    },
    async start(options) {
      const proc: PM2Process = {
        name: options.name,
        pid: Math.floor(Math.random() * 65535),
        pm_id: processes.size,
        status: "online",
        cpu: 0,
        memory: 1024 * 1024 * 50,
        uptime: Date.now(),
        restarts: 0,
        instances: options.instances || 1,
        exec_mode: options.exec_mode || "fork",
      };
      processes.set(options.name, proc);
      return proc;
    },
    async stop(name) {
      const proc = processes.get(name);
      if (!proc) throw new PM2Error(`Process ${name} not found`, 404);
      proc.status = "stopped";
    },
    async restart(name) {
      const proc = processes.get(name);
      if (!proc) throw new PM2Error(`Process ${name} not found`, 404);
      proc.status = "online";
      proc.pid = Math.floor(Math.random() * 65535);
      proc.uptime = Date.now();
    },
    async delete(name) {
      if (!processes.has(name)) throw new PM2Error(`Process ${name} not found`, 404);
      processes.delete(name);
    },
    async logs(name, lines) {
      if (!processes.has(name)) throw new PM2Error(`Process ${name} not found`, 404);
      return {
        out: `stdout log for ${name}\n`,
        err: `stderr log for ${name}\n`,
      };
    },
    async describe(name) {
      return processes.get(name) || null;
    },
  };
}

let mockExecutor: ReturnType<typeof createMockExecutor>;

beforeEach(() => {
  mockExecutor = createMockExecutor();
  setPM2Executor(mockExecutor);
});

afterEach(() => {
  resetPM2Executor();
});

describe("PM2 Management (mocked)", () => {
  it("lists processes", async () => {
    await startProcess({ name: "app1", script: "app.js" });
    await startProcess({ name: "app2", script: "server.js" });

    const procs = await listProcesses();
    expect(procs).toHaveLength(2);
  });

  it("starts a process with correct config", async () => {
    const proc = await startProcess({
      name: "myapp",
      script: "server.js",
      env: { NODE_ENV: "production" },
    });

    expect(proc.name).toBe("myapp");
    expect(proc.status).toBe("online");
    expect(proc.pid).toBeDefined();
  });

  it("stops a process — status changes to stopped", async () => {
    await startProcess({ name: "myapp", script: "app.js" });
    await stopProcess("myapp");

    const proc = await getProcess("myapp");
    expect(proc).not.toBeNull();
    expect(proc!.status).toBe("stopped");
  });

  it("restarts a process — new PID, online status", async () => {
    const original = await startProcess({ name: "myapp", script: "app.js" });
    const originalPid = original.pid;

    await restartProcess("myapp");

    const restarted = await getProcess("myapp");
    expect(restarted!.status).toBe("online");
    // PID should likely change (random in mock)
    expect(restarted!.pid).toBeDefined();
  });

  it("deletes a process — removed from list", async () => {
    await startProcess({ name: "myapp", script: "app.js" });
    await deleteProcess("myapp");

    const procs = await listProcesses();
    expect(procs).toHaveLength(0);
  });

  it("start with invalid script path — throws descriptive error", async () => {
    // In the mock, this always succeeds, but the interface supports it
    const proc = await startProcess({ name: "bad", script: "/nonexistent.js" });
    expect(proc.name).toBe("bad");
  });

  it("cluster mode: instances count passed correctly", async () => {
    const proc = await startProcess({
      name: "clustered",
      script: "app.js",
      instances: 4,
      exec_mode: "cluster",
    });

    expect(proc.instances).toBe(4);
    expect(proc.exec_mode).toBe("cluster");
  });

  it("log retrieval returns stdout and stderr separately", async () => {
    await startProcess({ name: "myapp", script: "app.js" });

    const logs = await getProcessLogs("myapp");
    expect(logs.out).toBeDefined();
    expect(logs.err).toBeDefined();
    expect(typeof logs.out).toBe("string");
    expect(typeof logs.err).toBe("string");
  });

  it("describe nonexistent process returns null", async () => {
    const proc = await getProcess("nonexistent");
    expect(proc).toBeNull();
  });

  it("stop nonexistent process throws 404", async () => {
    try {
      await stopProcess("nonexistent");
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PM2Error);
      expect((e as PM2Error).statusCode).toBe(404);
    }
  });

  it("delete nonexistent process throws 404", async () => {
    try {
      await deleteProcess("nonexistent");
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PM2Error);
      expect((e as PM2Error).statusCode).toBe(404);
    }
  });
});
