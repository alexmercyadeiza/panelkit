import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { detectRuntime } from "../../server/lib/buildpacks";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
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

function writePkg(extra: object = {}) {
  writeFile(
    "package.json",
    JSON.stringify({ name: "test", ...extra }, null, 2)
  );
}

// ─── Framework Detection ────────────────────────────────────────────────────

describe("Framework Detection", () => {
  it("detects Next.js", async () => {
    writePkg({
      dependencies: { next: "14.0.0", react: "18.0.0" },
      scripts: { build: "next build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("nextjs");
    expect(r.runtime).toBe("nodejs");
    expect(r.detectedBy).toBe("next");
    expect(r.startCommand).toContain("next start");
    expect(r.startCommand).toContain("$PORT");
    expect(r.buildOutputDirs).toEqual([".next"]);
  });

  it("detects Nuxt", async () => {
    writePkg({
      dependencies: { nuxt: "3.0.0" },
      scripts: { build: "nuxt build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("nuxt");
    expect(r.startCommand).toContain(".output/server/index.mjs");
    expect(r.buildOutputDirs).toContain(".output");
    expect(r.buildOutputDirs).toContain(".nuxt");
  });

  it("detects TanStack Start", async () => {
    writePkg({
      dependencies: { "@tanstack/start": "1.0.0", "@tanstack/react-router": "1.0.0" },
      scripts: { build: "vinxi build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("tanstack-start");
    expect(r.startCommand).toContain(".output/server/index.mjs");
    expect(r.buildOutputDirs).toEqual([".output"]);
  });

  it("detects Remix", async () => {
    writePkg({
      dependencies: { "@remix-run/react": "2.0.0" },
      devDependencies: { "@remix-run/dev": "2.0.0" },
      scripts: { build: "remix build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("remix");
    expect(r.startCommand).toContain("remix-serve");
    expect(r.buildOutputDirs).toEqual(["build"]);
  });

  it("detects SvelteKit", async () => {
    writePkg({
      devDependencies: { "@sveltejs/kit": "2.0.0" },
      scripts: { build: "vite build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("sveltekit");
    expect(r.startCommand).toBe("node build/index.js");
    expect(r.buildOutputDirs).toEqual(["build"]);
  });

  it("detects Astro", async () => {
    writePkg({
      dependencies: { astro: "4.0.0" },
      scripts: { build: "astro build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("astro");
    expect(r.startCommand).toContain("dist/server/entry.mjs");
    expect(r.buildOutputDirs).toEqual(["dist"]);
  });

  it("detects Vite SPA (vite without SSR framework)", async () => {
    writePkg({
      dependencies: { react: "18.0.0" },
      devDependencies: { vite: "5.0.0" },
      scripts: { build: "vite build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("vite-spa");
    expect(r.startCommand).toContain("serve -s dist");
    expect(r.startCommand).toContain("$PORT");
    expect(r.buildOutputDirs).toEqual(["dist"]);
  });

  it("detects Express", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { start: "node server.js" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("express");
    expect(r.buildOutputDirs).toEqual([]);
  });

  it("detects Fastify", async () => {
    writePkg({
      dependencies: { fastify: "4.0.0" },
      scripts: { start: "node server.js" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("fastify");
  });

  it("detects Hono", async () => {
    writePkg({
      dependencies: { hono: "3.0.0" },
      scripts: { start: "node server.js" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.framework).toBe("hono");
  });

  it("detects static site from index.html", async () => {
    writeFile("index.html", "<html></html>");
    const r = await detectRuntime(tempDir);
    expect(r.runtime).toBe("static");
    expect(r.framework).toBe("static");
    expect(r.detectedBy).toBe("index.html");
    expect(r.startCommand).toContain("serve -s .");
    expect(r.startCommand).toContain("$PORT");
    expect(r.installCommand).toBeNull();
    expect(r.buildOutputDirs).toEqual([]);
  });

  it('returns "unknown" for empty directory', async () => {
    const r = await detectRuntime(tempDir);
    expect(r.runtime).toBe("unknown");
    expect(r.framework).toBe("unknown");
    expect(r.detectedBy).toBeNull();
    expect(r.installCommand).toBeNull();
    expect(r.startCommand).toBeNull();
    expect(r.buildOutputDirs).toEqual([]);
  });

  it("generic Node.js fallback for unknown deps", async () => {
    writePkg({
      dependencies: { "some-lib": "1.0.0" },
      scripts: { start: "node app.js" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.runtime).toBe("nodejs");
    expect(r.framework).toBe("unknown");
    expect(r.detectedBy).toBe("package.json");
  });
});

// ─── Build Output Dirs ──────────────────────────────────────────────────────

describe("buildOutputDirs", () => {
  it("SSR frameworks have build output dirs", async () => {
    writePkg({
      dependencies: { next: "14.0.0" },
      scripts: { build: "next build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.buildOutputDirs.length).toBeGreaterThan(0);
  });

  it("server frameworks have empty build output dirs", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { start: "node index.js" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.buildOutputDirs).toEqual([]);
  });

  it("static sites have empty build output dirs", async () => {
    writeFile("index.html", "<html></html>");
    const r = await detectRuntime(tempDir);
    expect(r.buildOutputDirs).toEqual([]);
  });
});

// ─── Lockfile Detection ─────────────────────────────────────────────────────

describe("Lockfile Detection", () => {
  it("SSR frameworks use npm install when no package-lock.json", async () => {
    writePkg({
      dependencies: { next: "14.0.0" },
      scripts: { build: "next build" },
    });
    writeFile("bun.lockb", "");
    const r = await detectRuntime(tempDir);
    expect(r.installCommand).toBe("npm install");
    expect(r.buildCommand).toBe("npm run build");
  });

  it("SSR frameworks use npm ci when package-lock.json exists", async () => {
    writePkg({
      dependencies: { next: "14.0.0" },
      scripts: { build: "next build" },
    });
    writeFile("package-lock.json", "{}");
    const r = await detectRuntime(tempDir);
    expect(r.installCommand).toBe("npm ci");
    expect(r.buildCommand).toBe("npm run build");
  });

  it("Vite SPA uses npm install when no package-lock.json", async () => {
    writePkg({
      devDependencies: { vite: "5.0.0" },
      scripts: { build: "vite build" },
    });
    writeFile("bun.lockb", "");
    const r = await detectRuntime(tempDir);
    expect(r.installCommand).toBe("npm install");
    expect(r.buildCommand).toBe("npm run build");
  });

  it("server frameworks use native lockfile — npm ci by default", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { start: "node server.js" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.installCommand).toBe("npm ci");
  });

  it("server frameworks use yarn when yarn.lock present", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { start: "node server.js" },
    });
    writeFile("yarn.lock", "");
    const r = await detectRuntime(tempDir);
    expect(r.installCommand).toContain("yarn install");
    expect(r.installCommand).toContain("--frozen-lockfile");
  });

  it("server frameworks use pnpm when pnpm-lock.yaml present", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { start: "node server.js" },
    });
    writeFile("pnpm-lock.yaml", "");
    const r = await detectRuntime(tempDir);
    expect(r.installCommand).toContain("pnpm install");
    expect(r.installCommand).toContain("--frozen-lockfile");
  });

  it("server frameworks use bun when bun.lockb present", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { start: "node server.js" },
    });
    writeFile("bun.lockb", "");
    const r = await detectRuntime(tempDir);
    expect(r.installCommand).toContain("bun install");
  });

  it("server frameworks use bun when bun.lock present", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { start: "node server.js" },
    });
    writeFile("bun.lock", "");
    const r = await detectRuntime(tempDir);
    expect(r.installCommand).toContain("bun install");
  });
});

// ─── $PORT in start commands ────────────────────────────────────────────────

describe("$PORT in start commands", () => {
  it("static site start command includes $PORT", async () => {
    writeFile("index.html", "<html></html>");
    const r = await detectRuntime(tempDir);
    expect(r.startCommand).toContain("$PORT");
  });

  it("Vite SPA start command includes $PORT", async () => {
    writePkg({
      devDependencies: { vite: "5.0.0" },
      scripts: { build: "vite build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.startCommand).toContain("$PORT");
  });

  it("Next.js start command includes $PORT", async () => {
    writePkg({
      dependencies: { next: "14.0.0" },
      scripts: { build: "next build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.startCommand).toContain("$PORT");
  });
});

// ─── Build Commands ─────────────────────────────────────────────────────────

describe("Build Commands", () => {
  it("SSR frameworks use npm run build", async () => {
    writePkg({
      dependencies: { next: "14.0.0" },
      scripts: { build: "next build" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.buildCommand).toBe("npm run build");
  });

  it("buildCommand is null when no scripts.build", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { start: "node index.js" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.buildCommand).toBeNull();
  });

  it("server frameworks use native runner for build", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { build: "tsc", start: "node dist/index.js" },
    });
    writeFile("bun.lockb", "");
    const r = await detectRuntime(tempDir);
    expect(r.buildCommand).toBe("bun run build");
  });
});

// ─── Start Commands ─────────────────────────────────────────────────────────

describe("Start Commands", () => {
  it("server framework uses scripts.start if available", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      scripts: { start: "node server.js" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.startCommand).toBe("npm start");
  });

  it("server framework falls back to pkg.main", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
      main: "app.js",
    });
    const r = await detectRuntime(tempDir);
    expect(r.startCommand).toBe("node app.js");
  });

  it("server framework falls back to node index.js", async () => {
    writePkg({
      dependencies: { express: "4.18.0" },
    });
    const r = await detectRuntime(tempDir);
    expect(r.startCommand).toBe("node index.js");
  });
});
