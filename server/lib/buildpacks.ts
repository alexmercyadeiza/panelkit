// ─── Buildpack Detection & Runtime Commands ──────────────────────────────────

import { join } from "path";

export type Runtime = "nodejs" | "static" | "unknown";

export type Framework =
  | "nextjs"
  | "nuxt"
  | "tanstack-start"
  | "remix"
  | "sveltekit"
  | "astro"
  | "vite-spa"
  | "express"
  | "fastify"
  | "hono"
  | "static"
  | "unknown";

export interface DetectionResult {
  runtime: Runtime;
  /** Specific framework detected */
  framework: Framework;
  /** The file that triggered detection */
  detectedBy: string | null;
  /** Command to install dependencies */
  installCommand: string | null;
  /** Command to build the application (null if no build needed) */
  buildCommand: string | null;
  /** Command to start the application */
  startCommand: string | null;
  /** Default port the app listens on */
  defaultPort: number;
  /** Directories created by the build step (to clean before redeploy) */
  buildOutputDirs: string[];
}

// ─── Framework Detection Table ──────────────────────────────────────────────

interface FrameworkDef {
  framework: Framework;
  /** Dependency key to look for in package.json */
  dep: string;
  buildOutputDirs: string[];
  startCommand: string;
}

const FRAMEWORK_DEFS: FrameworkDef[] = [
  {
    framework: "nextjs",
    dep: "next",
    buildOutputDirs: [".next"],
    startCommand: "npx next start -p $PORT",
  },
  {
    framework: "nuxt",
    dep: "nuxt",
    buildOutputDirs: [".output", ".nuxt"],
    startCommand: "node .output/server/index.mjs",
  },
  {
    framework: "tanstack-start",
    dep: "@tanstack/start",
    buildOutputDirs: [".output"],
    startCommand: "node .output/server/index.mjs",
  },
  {
    framework: "remix",
    dep: "@remix-run/dev",
    buildOutputDirs: ["build"],
    startCommand: "npx remix-serve ./build/server/index.js",
  },
  {
    framework: "sveltekit",
    dep: "@sveltejs/kit",
    buildOutputDirs: ["build"],
    startCommand: "node build/index.js",
  },
  {
    framework: "astro",
    dep: "astro",
    buildOutputDirs: ["dist"],
    startCommand: "node ./dist/server/entry.mjs",
  },
];

/** Server frameworks — no build output dirs, use scripts.start or main */
const SERVER_FRAMEWORKS: { framework: Framework; dep: string }[] = [
  { framework: "express", dep: "express" },
  { framework: "fastify", dep: "fastify" },
  { framework: "hono", dep: "hono" },
];

/**
 * Detect the runtime and framework of a project by examining files in the given directory.
 * Returns install, build, and start commands for PM2-based deployment.
 */
export async function detectRuntime(dir: string): Promise<DetectionResult> {
  // 1. Node.js — package.json
  if (await fileExists(join(dir, "package.json"))) {
    return detectNodeFramework(dir);
  }

  // 2. Static site — index.html (no package.json)
  if (await fileExists(join(dir, "index.html"))) {
    return {
      runtime: "static",
      framework: "static",
      detectedBy: "index.html",
      installCommand: null,
      buildCommand: null,
      startCommand: "npx serve -s . -l $PORT",
      defaultPort: 3000,
      buildOutputDirs: [],
    };
  }

  // 3. Unknown
  return {
    runtime: "unknown",
    framework: "unknown",
    detectedBy: null,
    installCommand: null,
    buildCommand: null,
    startCommand: null,
    defaultPort: 3000,
    buildOutputDirs: [],
  };
}

// ─── Node.js Framework Detection ────────────────────────────────────────────

/**
 * SSR frameworks (Next.js, Nuxt, Remix, SvelteKit, Astro, Vite) spawn Node.js
 * subprocesses during build (Turbopack, PostCSS, Vite, etc.). Bun's module
 * resolution is incompatible with Node's require(), so even if a bun.lockb
 * exists, we must use npm install for anything that builds with Node.
 *
 * We use `npm install` (not `npm ci`) because repos may only ship a bun.lockb
 * or yarn.lock — `npm ci` requires package-lock.json to exist.
 *
 * Only pure server apps (Express, Fastify, Hono) with no framework build step
 * can safely use the native lockfile manager.
 */
async function detectNodeFramework(dir: string): Promise<DetectionResult> {
  const lockfile = await detectNodeLockfile(dir);

  let pkg: any = {};
  try {
    pkg = await Bun.file(join(dir, "package.json")).json();
  } catch {
    // Fallback to defaults
  }

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // Determine install command for SSR frameworks:
  // Must include devDependencies (tailwindcss, postcss plugins, etc. are needed
  // at build time). Use --production=false to override NODE_ENV=production.
  // If package-lock.json exists → npm ci (fast, deterministic)
  // Otherwise → npm install (generates node_modules from package.json)
  const hasNpmLock = await fileExists(join(dir, "package-lock.json"));
  const ssrInstallCmd = hasNpmLock
    ? "npm ci --include=dev"
    : "npm install --include=dev";

  // ── SSR / build-step frameworks (must use npm for Node compatibility) ──

  for (const def of FRAMEWORK_DEFS) {
    if (allDeps[def.dep]) {
      const buildCmd = pkg.scripts?.build ? "npm run build" : null;
      return {
        runtime: "nodejs",
        framework: def.framework,
        detectedBy: def.dep,
        installCommand: ssrInstallCmd,
        buildCommand: buildCmd,
        startCommand: def.startCommand,
        defaultPort: 3000,
        buildOutputDirs: def.buildOutputDirs,
      };
    }
  }

  // Vite SPA — also builds with Node (PostCSS, esbuild, etc.)
  if (allDeps["vite"]) {
    const buildCmd = pkg.scripts?.build ? "npm run build" : null;
    return {
      runtime: "nodejs",
      framework: "vite-spa",
      detectedBy: "vite",
      installCommand: ssrInstallCmd,
      buildCommand: buildCmd,
      startCommand: "npx serve -s dist -l $PORT",
      defaultPort: 3000,
      buildOutputDirs: ["dist"],
    };
  }

  // ── Server frameworks (safe to use native lockfile manager) ────────────

  const nativeRun = {
    npm: "npm run",
    yarn: "yarn",
    pnpm: "pnpm run",
    bun: "bun run",
  }[lockfile];

  const nativeInstallCmd = {
    npm: "npm ci",
    yarn: "yarn install --frozen-lockfile",
    pnpm: "pnpm install --frozen-lockfile",
    bun: "bun install",
  }[lockfile];

  for (const sf of SERVER_FRAMEWORKS) {
    if (allDeps[sf.dep]) {
      const startCmd = resolveServerStartCommand(pkg, lockfile);
      const buildCmd = pkg.scripts?.build ? `${nativeRun} build` : null;
      return {
        runtime: "nodejs",
        framework: sf.framework,
        detectedBy: sf.dep,
        installCommand: nativeInstallCmd,
        buildCommand: buildCmd,
        startCommand: startCmd,
        defaultPort: 3000,
        buildOutputDirs: [],
      };
    }
  }

  // ── Generic Node.js fallback (use native lockfile manager) ─────────────

  const startCmd = resolveServerStartCommand(pkg, lockfile);
  const buildCmd = pkg.scripts?.build ? `${nativeRun} build` : null;
  return {
    runtime: "nodejs",
    framework: "unknown",
    detectedBy: "package.json",
    installCommand: nativeInstallCmd,
    buildCommand: buildCmd,
    startCommand: startCmd,
    defaultPort: 3000,
    buildOutputDirs: [],
  };
}

function resolveServerStartCommand(pkg: any, lockfile: NodePkgManager): string {
  if (pkg.scripts?.start) {
    if (lockfile === "npm") return "npm start";
    return `${lockfile} start`;
  }
  if (pkg.main) {
    return `node ${pkg.main}`;
  }
  return "node index.js";
}

// ─── Lockfile Detection ─────────────────────────────────────────────────────

type NodePkgManager = "npm" | "yarn" | "pnpm" | "bun";

async function detectNodeLockfile(dir: string): Promise<NodePkgManager> {
  if (
    (await fileExists(join(dir, "bun.lockb"))) ||
    (await fileExists(join(dir, "bun.lock")))
  )
    return "bun";
  if (await fileExists(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(join(dir, "yarn.lock"))) return "yarn";
  return "npm";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
  }
}
