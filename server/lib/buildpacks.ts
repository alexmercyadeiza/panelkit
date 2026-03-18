// ─── Buildpack Detection & Dockerfile Generation ────────────────────────────

import { join } from "path";

export type Runtime =
  | "nodejs"
  | "python"
  | "go"
  | "php"
  | "static"
  | "dockerfile"
  | "unknown";

export interface DetectionResult {
  runtime: Runtime;
  /** The file that triggered detection */
  detectedBy: string | null;
  /** Generated Dockerfile content (null if runtime is "dockerfile" or "unknown") */
  dockerfile: string | null;
}

/**
 * Detect the runtime of a project by examining files in the given directory.
 * If a Dockerfile already exists, prefer it.
 */
export async function detectRuntime(dir: string): Promise<DetectionResult> {
  // 1. Check for explicit Dockerfile first
  if (await fileExists(join(dir, "Dockerfile"))) {
    return {
      runtime: "dockerfile",
      detectedBy: "Dockerfile",
      dockerfile: null,
    };
  }

  // 2. Node.js — package.json
  if (await fileExists(join(dir, "package.json"))) {
    const dockerfile = await generateNodeDockerfile(dir);
    return { runtime: "nodejs", detectedBy: "package.json", dockerfile };
  }

  // 3. Python — requirements.txt, pyproject.toml, Pipfile
  for (const file of ["requirements.txt", "pyproject.toml", "Pipfile"]) {
    if (await fileExists(join(dir, file))) {
      const dockerfile = generatePythonDockerfile(file);
      return { runtime: "python", detectedBy: file, dockerfile };
    }
  }

  // 4. Go — go.mod
  if (await fileExists(join(dir, "go.mod"))) {
    const dockerfile = generateGoDockerfile();
    return { runtime: "go", detectedBy: "go.mod", dockerfile };
  }

  // 5. PHP — composer.json
  if (await fileExists(join(dir, "composer.json"))) {
    const dockerfile = generatePhpDockerfile();
    return { runtime: "php", detectedBy: "composer.json", dockerfile };
  }

  // 6. Static site — index.html
  if (await fileExists(join(dir, "index.html"))) {
    const dockerfile = generateStaticDockerfile();
    return { runtime: "static", detectedBy: "index.html", dockerfile };
  }

  // 7. Unknown
  return { runtime: "unknown", detectedBy: null, dockerfile: null };
}

// ─── Node.js Dockerfile Generation ──────────────────────────────────────────

async function generateNodeDockerfile(dir: string): Promise<string> {
  const lockfile = await detectNodeLockfile(dir);

  const installCmd = {
    npm: "npm ci --only=production",
    yarn: "yarn install --frozen-lockfile --production",
    pnpm: "pnpm install --frozen-lockfile --prod",
    bun: "bun install --frozen-lockfile --production",
  }[lockfile];

  const copyLock = {
    npm: "COPY package.json package-lock.json* ./",
    yarn: "COPY package.json yarn.lock* ./",
    pnpm: "COPY package.json pnpm-lock.yaml* ./",
    bun: "COPY package.json bun.lockb* bun.lock* ./",
  }[lockfile];

  const baseImage = lockfile === "bun" ? "oven/bun:1-alpine" : "node:20-alpine";
  const startCmd = lockfile === "bun" ? 'CMD ["bun", "start"]' : 'CMD ["node", "index.js"]';

  return `FROM ${baseImage}
WORKDIR /app
${copyLock}
RUN ${installCmd}
COPY . .
EXPOSE 3000
${startCmd}
`;
}

type NodePkgManager = "npm" | "yarn" | "pnpm" | "bun";

async function detectNodeLockfile(dir: string): Promise<NodePkgManager> {
  if (await fileExists(join(dir, "bun.lockb")) || await fileExists(join(dir, "bun.lock"))) return "bun";
  if (await fileExists(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(join(dir, "yarn.lock"))) return "yarn";
  return "npm";
}

// ─── Python Dockerfile Generation ───────────────────────────────────────────

function generatePythonDockerfile(detectedBy: string): string {
  let installLines: string;

  switch (detectedBy) {
    case "pyproject.toml":
      installLines = `COPY pyproject.toml ./
RUN pip install --no-cache-dir poetry && poetry config virtualenvs.create false && poetry install --no-dev --no-interaction`;
      break;
    case "Pipfile":
      installLines = `COPY Pipfile Pipfile.lock* ./
RUN pip install --no-cache-dir pipenv && pipenv install --system --deploy`;
      break;
    default: // requirements.txt
      installLines = `COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt`;
      break;
  }

  return `FROM python:3.12-slim
WORKDIR /app
${installLines}
COPY . .
EXPOSE 8000
CMD ["python", "app.py"]
`;
}

// ─── Go Dockerfile Generation ───────────────────────────────────────────────

function generateGoDockerfile(): string {
  return `FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/server .
EXPOSE 8080
CMD ["./server"]
`;
}

// ─── PHP Dockerfile Generation ──────────────────────────────────────────────

function generatePhpDockerfile(): string {
  return `FROM php:8.3-apache
WORKDIR /var/www/html
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer
COPY composer.json composer.lock* ./
RUN composer install --no-dev --optimize-autoloader
COPY . .
RUN chown -R www-data:www-data /var/www/html
EXPOSE 80
`;
}

// ─── Static Site Dockerfile Generation ──────────────────────────────────────

function generateStaticDockerfile(): string {
  return `FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
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
