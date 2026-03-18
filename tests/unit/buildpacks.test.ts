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
    expect(result.dockerfile).toBeNull();
  });

  it("prefers explicit Dockerfile over auto-detection", async () => {
    writeFile("Dockerfile", "FROM node:20\n");
    writeFile("package.json", "{}");

    const result = await detectRuntime(tempDir);
    expect(result.runtime).toBe("dockerfile");
    expect(result.detectedBy).toBe("Dockerfile");
    expect(result.dockerfile).toBeNull(); // Don't generate if one exists
  });
});

describe("Dockerfile Generation", () => {
  it("generated Node.js Dockerfile is valid", async () => {
    writeFile("package.json", '{"name":"test"}');
    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toBeDefined();
    expect(result.dockerfile).toContain("FROM");
    expect(result.dockerfile).toContain("EXPOSE");
    expect(result.dockerfile).toContain("WORKDIR");
  });

  it("Node.js uses npm when package-lock.json present", async () => {
    writeFile("package.json", "{}");
    writeFile("package-lock.json", "{}");

    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("npm ci");
  });

  it("Node.js uses yarn when yarn.lock present", async () => {
    writeFile("package.json", "{}");
    writeFile("yarn.lock", "");

    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("yarn install");
  });

  it("Node.js uses pnpm when pnpm-lock.yaml present", async () => {
    writeFile("package.json", "{}");
    writeFile("pnpm-lock.yaml", "");

    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("pnpm install");
  });

  it("Node.js uses bun when bun.lockb present", async () => {
    writeFile("package.json", "{}");
    writeFile("bun.lockb", "");

    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("bun install");
    expect(result.dockerfile).toContain("oven/bun");
  });

  it("Python Dockerfile uses pip for requirements.txt", async () => {
    writeFile("requirements.txt", "flask\n");
    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("pip install");
    expect(result.dockerfile).toContain("requirements.txt");
  });

  it("Python Dockerfile uses poetry for pyproject.toml", async () => {
    writeFile("pyproject.toml", "[tool.poetry]");
    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("poetry");
  });

  it("Python Dockerfile uses pipenv for Pipfile", async () => {
    writeFile("Pipfile", "[[source]]");
    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("pipenv");
  });

  it("Go Dockerfile uses multi-stage build", async () => {
    writeFile("go.mod", "module example.com/app");
    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("AS builder");
    expect(result.dockerfile).toContain("CGO_ENABLED=0");
    expect(result.dockerfile).toContain("COPY --from=builder");
  });

  it("PHP Dockerfile uses composer", async () => {
    writeFile("composer.json", "{}");
    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("composer");
  });

  it("Static Dockerfile uses nginx", async () => {
    writeFile("index.html", "<html></html>");
    const result = await detectRuntime(tempDir);
    expect(result.dockerfile).toContain("nginx");
  });
});
