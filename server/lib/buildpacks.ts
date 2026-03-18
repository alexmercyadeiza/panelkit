// ─── Buildpack Detection & Runtime Commands ──────────────────────────────────

import { join } from "path";

export type Runtime =
  | "nodejs"
  | "python"
  | "go"
  | "php"
  | "static"
  | "unknown";

export interface DetectionResult {
  runtime: Runtime;
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
}

/**
 * Detect the runtime of a project by examining files in the given directory.
 * Returns install and start commands for PM2-based deployment.
 */
export async function detectRuntime(dir: string): Promise<DetectionResult> {
  // 1. Node.js — package.json
  if (await fileExists(join(dir, "package.json"))) {
    const commands = await getNodeCommands(dir);
    return {
      runtime: "nodejs",
      detectedBy: "package.json",
      installCommand: commands.install,
      buildCommand: commands.build,
      startCommand: commands.start,
      defaultPort: 3000,
    };
  }

  // 2. Python — requirements.txt, pyproject.toml, Pipfile
  for (const file of ["requirements.txt", "pyproject.toml", "Pipfile"] as const) {
    if (await fileExists(join(dir, file))) {
      const commands = getPythonCommands(file);
      return {
        runtime: "python",
        detectedBy: file,
        installCommand: commands.install,
        buildCommand: null,
        startCommand: commands.start,
        defaultPort: 8000,
      };
    }
  }

  // 3. Go — go.mod
  if (await fileExists(join(dir, "go.mod"))) {
    return {
      runtime: "go",
      detectedBy: "go.mod",
      installCommand: "go build -o server .",
      buildCommand: null,
      startCommand: "./server",
      defaultPort: 8080,
    };
  }

  // 4. PHP — composer.json
  if (await fileExists(join(dir, "composer.json"))) {
    return {
      runtime: "php",
      detectedBy: "composer.json",
      installCommand: "composer install --no-dev --optimize-autoloader",
      buildCommand: null,
      startCommand: "php -S 0.0.0.0:80 -t .",
      defaultPort: 80,
    };
  }

  // 5. Static site — index.html
  if (await fileExists(join(dir, "index.html"))) {
    return {
      runtime: "static",
      detectedBy: "index.html",
      installCommand: null,
      buildCommand: null,
      startCommand: "npx serve -s . -l 80",
      defaultPort: 80,
    };
  }

  // 6. Unknown
  return {
    runtime: "unknown",
    detectedBy: null,
    installCommand: null,
    buildCommand: null,
    startCommand: null,
    defaultPort: 3000,
  };
}

// ─── Node.js Commands ────────────────────────────────────────────────────────

async function getNodeCommands(
  dir: string
): Promise<{ install: string; build: string | null; start: string }> {
  const lockfile = await detectNodeLockfile(dir);

  const run = {
    npm: "npm run",
    yarn: "yarn",
    pnpm: "pnpm run",
    bun: "bun run",
  }[lockfile];

  const installCmd = {
    npm: "npm install",
    yarn: "yarn install --frozen-lockfile",
    pnpm: "pnpm install --frozen-lockfile",
    bun: "bun install",
  }[lockfile];

  let buildCmd: string | null = null;
  let startCmd: string;

  try {
    const pkg = await Bun.file(join(dir, "package.json")).json();

    // Detect build script
    if (pkg.scripts?.build) {
      buildCmd = `${run} build`;
    }

    // Detect start script
    if (pkg.scripts?.start) {
      startCmd = `${run.replace(" run", "")} start`;
      // npm needs "npm start" not "npm run start"
      if (lockfile === "npm") startCmd = "npm start";
    } else if (pkg.scripts?.preview) {
      // For frameworks that build then preview (Vite, TanStack Start, etc.)
      startCmd = `${run} preview`;
    } else if (pkg.main) {
      startCmd = lockfile === "bun" ? `bun ${pkg.main}` : `node ${pkg.main}`;
    } else {
      startCmd = lockfile === "bun" ? "bun index.js" : "node index.js";
    }
  } catch {
    startCmd = lockfile === "bun" ? "bun start" : "npm start";
  }

  return { install: installCmd, build: buildCmd, start: startCmd };
}

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

// ─── Python Commands ─────────────────────────────────────────────────────────

function getPythonCommands(
  detectedBy: string
): { install: string; start: string } {
  switch (detectedBy) {
    case "pyproject.toml":
      return {
        install:
          "pip install --no-cache-dir poetry && poetry config virtualenvs.create false && poetry install --no-dev --no-interaction",
        start: "python app.py",
      };
    case "Pipfile":
      return {
        install:
          "pip install --no-cache-dir pipenv && pipenv install --system --deploy",
        start: "python app.py",
      };
    default: // requirements.txt
      return {
        install: "pip install --no-cache-dir -r requirements.txt",
        start: "python app.py",
      };
  }
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
