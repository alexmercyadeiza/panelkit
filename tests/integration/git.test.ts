import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadConfig } from "../../server/config";
import {
  cloneRepo,
  pullRepo,
  getHeadCommit,
  getCommitMessage,
} from "../../server/services/git.service";

loadConfig({
  NODE_ENV: "test",
  MASTER_KEY: "a".repeat(64),
  DATA_DIR: tmpdir(),
});

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "git-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Git Operations", () => {
  // Use a small, fast, public repo for integration tests
  const TEST_REPO = "https://github.com/octocat/Hello-World.git";

  it("clones a public repo successfully", async () => {
    const targetDir = join(tempDir, "repo");
    const result = await cloneRepo({
      repoUrl: TEST_REPO,
      targetDir,
      depth: 1,
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(targetDir, ".git"))).toBe(true);
  }, 30000);

  it("clone creates directory at expected path", async () => {
    const targetDir = join(tempDir, "my-app-repo");
    await cloneRepo({
      repoUrl: TEST_REPO,
      targetDir,
      depth: 1,
    });

    expect(existsSync(targetDir)).toBe(true);
    expect(existsSync(join(targetDir, ".git"))).toBe(true);
  }, 30000);

  it("clone with specific branch", async () => {
    const targetDir = join(tempDir, "branch-test");
    const result = await cloneRepo({
      repoUrl: TEST_REPO,
      targetDir,
      branch: "master",
      depth: 1,
    });

    expect(result.success).toBe(true);
  }, 30000);

  it("clone failure (bad URL) returns descriptive error and cleans up", async () => {
    const targetDir = join(tempDir, "bad-repo");
    const result = await cloneRepo({
      repoUrl: "https://github.com/nonexistent/repo-that-does-not-exist-12345.git",
      targetDir,
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);

    // Should clean up the partial clone directory
    expect(existsSync(targetDir)).toBe(false);
  }, 30000);

  it("getHeadCommit returns a commit hash", async () => {
    const targetDir = join(tempDir, "commit-test");
    await cloneRepo({
      repoUrl: TEST_REPO,
      targetDir,
      depth: 1,
    });

    const hash = await getHeadCommit(targetDir);
    expect(hash).not.toBeNull();
    expect(hash!.length).toBe(40);
    expect(/^[0-9a-f]{40}$/.test(hash!)).toBe(true);
  }, 30000);

  it("getCommitMessage returns a message", async () => {
    const targetDir = join(tempDir, "msg-test");
    await cloneRepo({
      repoUrl: TEST_REPO,
      targetDir,
      depth: 1,
    });

    const msg = await getCommitMessage(targetDir);
    expect(msg).not.toBeNull();
    expect(msg!.length).toBeGreaterThan(0);
  }, 30000);

  it("pull updates existing clone", async () => {
    const targetDir = join(tempDir, "pull-test");
    await cloneRepo({
      repoUrl: TEST_REPO,
      targetDir,
      depth: 1,
    });

    const result = await pullRepo(targetDir);
    expect(result.success).toBe(true);
  }, 30000);

  it("getHeadCommit on non-repo returns null", async () => {
    const hash = await getHeadCommit(tempDir);
    expect(hash).toBeNull();
  });
});
