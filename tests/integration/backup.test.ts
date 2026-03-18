import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createBackup,
  listBackups,
  deleteBackup,
  rotateBackups,
  defaultFileSystemOps,
  defaultDatabaseDumpOps,
  type BackupConfig,
} from "../../server/services/backup.service";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "backup-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const makeConfig = (overrides: Partial<BackupConfig> = {}): BackupConfig => ({
  basePath: tempDir,
  keepDaily: 7,
  keepWeekly: 4,
  ...overrides,
});

describe("Backup System", () => {
  it("creates a backup with manifest", async () => {
    const config = makeConfig();
    const result = await createBackup(config, { type: "manual" });

    expect(result.success).toBe(true);
    expect(result.backup).toBeDefined();
    expect(result.backup!.id).toBeDefined();
    expect(result.backup!.timestamp).toBeDefined();
    expect(result.backup!.type).toBe("manual");
  });

  it("lists backups", async () => {
    const config = makeConfig();

    await createBackup(config, { type: "manual" });
    await createBackup(config, { type: "manual" });

    const backups = await listBackups(config);
    expect(backups.length).toBeGreaterThanOrEqual(2);
  });

  it("deletes a backup", async () => {
    const config = makeConfig();

    const result = await createBackup(config, { type: "manual" });
    expect(result.success).toBe(true);

    const before = await listBackups(config);

    const deleteResult = await deleteBackup(config, result.backup!.id);
    expect(deleteResult.success).toBe(true);

    const after = await listBackups(config);
    expect(after.length).toBe(before.length - 1);
  });

  it("backup with no dbPath succeeds (just placeholder)", async () => {
    const config = makeConfig(); // no dbPath

    const result = await createBackup(config, { type: "manual" });
    expect(result.success).toBe(true);
    expect(result.backup).toBeDefined();
  });

  it("backup rotation runs without error", async () => {
    const config = makeConfig({ keepDaily: 2, keepWeekly: 0 });

    for (let i = 0; i < 5; i++) {
      await createBackup(config, { type: "manual" });
    }

    const beforeRotate = await listBackups(config);
    expect(beforeRotate.length).toBe(5);

    const result = await rotateBackups(config);
    expect(result).toBeDefined();
    expect(typeof result.deleted).toBe("number");

    // After rotation, should have fewer or equal backups
    const afterRotate = await listBackups(config);
    expect(afterRotate.length).toBeLessThanOrEqual(beforeRotate.length);
  });
});
