import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { detectRuntime } from "../../server/lib/buildpacks";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "buildpack-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string = "") {
  writeFileSync(join(tempDir, name), content);
}

describe("Runtime Detection", () => {
  it("detects Node.js from package.json", async () => {
    writeFile("package.json", '{"name":"test"}');
    const result = await detectRuntime(tempDir);
    expect(result.runtime).toBe("nodejs");
    expect(result.detectedBy).toBe("package.json");
  });

  it("detects Python from requirements.txt", async () => {
    writeFile("requirements.txt", "flask==2.0\n");
    const result = await detectRuntime(tempDir);
    expect(result.runtime).toBe("python");
    expect(result.detectedBy).toBe("requirements.txt");
  });

  it("detects Python from pyproject.toml", async () => {
    writeFile("pyproject.toml", "[tool.poetry]");
    const result = await detectRuntime(tempDir);
    expect(result.runtime).toBe("python");
    expect(result.detectedBy).toBe("pyproject.toml");
  });

  it("detects Python from Pipfile", async () => {
    writeFile("Pipfile", "[[source]]");
    const result = await detectRuntime(tempDir);
    expect(result.runtime).toBe("python");
    expect(result.detectedBy).toBe("Pipfile");
  });

  it("detects Go from go.mod", async () => {
    writeFile("go.mod", "module example.com/app");
    const result = await detectRuntime(tempDir);
    expect(result.runtime).toBe("go");
    expect(result.detectedBy).toBe("go.mod");
  });

  it("detects PHP from composer.json", async () => {
    writeFile("composer.json", '{"require":{}}');
    const result = await detectRuntime(tempDir);
    expect(result.runtime).toBe("php");
    expect(result.detectedBy).toBe("composer.json");
  });

  it("detects static site from index.html", async () => {
    writeFile("index.html", "<html></html>");
    const result = await detectRuntime(tempDir);
    expect(result.runtime).toBe("static");
    expect(result.detectedBy).toBe("index.html");
  });

  it('returns "unknown" for empty directory', async () => {
    const result = await detectRuntime(tempDir);
    expect(result.runtime).toBe("unknown");
    expect(result.detectedBy).toBeNull();
    expect(result.installCommand).toBeNull();
    expect(result.startCommand).toBeNull();
  });
});

describe("Runtime Commands", () => {
  it("Node.js returns install and start commands", async () => {
    writeFile("package.json", '{"name":"test","scripts":{"start":"node server.js"}}');
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toBeDefined();
    expect(result.startCommand).toBeDefined();
    expect(result.defaultPort).toBe(3000);
  });

  it("Node.js uses npm install by default", async () => {
    writeFile("package.json", '{"name":"test"}');
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toContain("npm install");
  });

  it("Node.js uses yarn when yarn.lock present", async () => {
    writeFile("package.json", "{}");
    writeFile("yarn.lock", "");
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toContain("yarn install");
  });

  it("Node.js uses pnpm when pnpm-lock.yaml present", async () => {
    writeFile("package.json", "{}");
    writeFile("pnpm-lock.yaml", "");
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toContain("pnpm install");
  });

  it("Node.js uses bun when bun.lockb present", async () => {
    writeFile("package.json", "{}");
    writeFile("bun.lockb", "");
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toContain("bun install");
  });

  it("Python uses pip for requirements.txt", async () => {
    writeFile("requirements.txt", "flask\n");
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toContain("pip install");
    expect(result.installCommand).toContain("requirements.txt");
    expect(result.startCommand).toContain("python");
    expect(result.defaultPort).toBe(8000);
  });

  it("Python uses poetry for pyproject.toml", async () => {
    writeFile("pyproject.toml", "[tool.poetry]");
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toContain("poetry");
  });

  it("Python uses pipenv for Pipfile", async () => {
    writeFile("Pipfile", "[[source]]");
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toContain("pipenv");
  });

  it("Go returns build command", async () => {
    writeFile("go.mod", "module example.com/app");
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toContain("go build");
    expect(result.startCommand).toBe("./server");
    expect(result.defaultPort).toBe(8080);
  });

  it("PHP uses composer", async () => {
    writeFile("composer.json", "{}");
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toContain("composer install");
    expect(result.defaultPort).toBe(80);
  });

  it("Static site has no install command", async () => {
    writeFile("index.html", "<html></html>");
    const result = await detectRuntime(tempDir);
    expect(result.installCommand).toBeNull();
    expect(result.startCommand).toBeDefined();
    expect(result.defaultPort).toBe(80);
  });
});
