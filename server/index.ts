import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "hono/bun";
import { loadConfig, getConfig } from "./config";
import { createDatabase, setDb, ensureTables } from "./db";
import { errorHandler } from "./middleware/error-handler";
import { rateLimiter } from "./middleware/rate-limit";
import { authRoutes } from "./routes/auth.routes";
import { appsRoutes, webhookRoute } from "./routes/apps.routes";
import { statsRoutes } from "./routes/stats.routes";
import { databasesRoutes } from "./routes/databases.routes";
import { storageRoutes } from "./routes/storage.routes";
import { cronRoutes } from "./routes/cron.routes";
import { pm2Routes } from "./routes/pm2.routes";
import { domainsRoutes } from "./routes/domains.routes";
import { firewallRoutes } from "./routes/firewall.routes";
import { usersRoutes } from "./routes/users.routes";
import { backupsRoutes } from "./routes/backups.routes";
import { notificationsRoutes } from "./routes/notifications.routes";
import { githubRoutes } from "./routes/github.routes";
import { DeployError } from "./services/deploy.service";
import { getTransformedStats } from "./services/stats.service";
import type { ServerWebSocket } from "bun";

// Load configuration
const config = loadConfig();

// Initialize database
const db = createDatabase(config.DATABASE_URL);
setDb(db);
ensureTables(db);

// Create Hono app
const app = new Hono();

// ─── Global Middleware ───────────────────────────────────────────────────────

app.use("*", logger());

app.use(
  "*",
  cors({
    origin: config.NODE_ENV === "production" ? [] : ["http://localhost:5173"],
    credentials: true,
  })
);

app.use("*", secureHeaders());

app.use("/api/*", rateLimiter());

// ─── Error Handler ───────────────────────────────────────────────────────────

app.onError(errorHandler);

// ─── API Routes ──────────────────────────────────────────────────────────────

app.route("/api/auth", authRoutes);
app.route("/api/apps", appsRoutes);
app.route("/api/apps", webhookRoute);
app.route("/api/stats", statsRoutes);
app.route("/api/databases", databasesRoutes);
app.route("/api/storage", storageRoutes);
app.route("/api/cron", cronRoutes);
app.route("/api/pm2", pm2Routes);
app.route("/api/domains", domainsRoutes);
app.route("/api/firewall", firewallRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/backups", backupsRoutes);
app.route("/api/notifications", notificationsRoutes);
app.route("/api/github", githubRoutes);

// Health check + server info
app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
    serverIp: config.SERVER_IP || null,
  })
);

// ─── SPA Serving ─────────────────────────────────────────────────────────────

app.use(
  "/assets/*",
  serveStatic({ root: "./dashboard/dist" })
);

app.get("*", serveStatic({ root: "./dashboard/dist", path: "/index.html" }));

// ─── WebSocket Infrastructure ───────────────────────────────────────────────

interface WsData {
  type: "stats" | "terminal";
  shellProcess?: ReturnType<typeof Bun.spawn>;
  readLoop?: Promise<void>;
}

// Stats WebSocket subscribers
const statsClients = new Set<ServerWebSocket<WsData>>();
let statsInterval: ReturnType<typeof setInterval> | null = null;

function startStatsInterval() {
  if (statsInterval) return;
  statsInterval = setInterval(async () => {
    if (statsClients.size === 0) {
      stopStatsInterval();
      return;
    }
    try {
      const stats = await getTransformedStats();
      const payload = JSON.stringify(stats);
      for (const ws of statsClients) {
        try {
          ws.send(payload);
        } catch {
          statsClients.delete(ws);
        }
      }
    } catch {
      // Collection failed, skip this tick
    }
  }, 3000);
}

function stopStatsInterval() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
}

// ─── Start Server ────────────────────────────────────────────────────────────

export { app };

export function createApp(dbPath?: string) {
  const testApp = new Hono();

  testApp.use(
    "*",
    cors({
      origin: "*",
      credentials: true,
    })
  );

  testApp.use("*", secureHeaders());
  testApp.use("/api/*", rateLimiter());
  testApp.onError(errorHandler);
  testApp.route("/api/auth", authRoutes);
  testApp.route("/api/apps", appsRoutes);
  testApp.route("/api/apps", webhookRoute);
  testApp.route("/api/stats", statsRoutes);
  testApp.route("/api/databases", databasesRoutes);
  testApp.route("/api/storage", storageRoutes);
  testApp.route("/api/cron", cronRoutes);
  testApp.route("/api/pm2", pm2Routes);
  testApp.route("/api/domains", domainsRoutes);
  testApp.route("/api/firewall", firewallRoutes);
  testApp.route("/api/users", usersRoutes);
  testApp.route("/api/backups", backupsRoutes);
  testApp.route("/api/notifications", notificationsRoutes);
  testApp.route("/api/github", githubRoutes);

  testApp.get("/api/health", (c) =>
    c.json({
      status: "ok",
      version: "0.1.0",
      uptime: process.uptime(),
    })
  );

  return testApp;
}

if (import.meta.main) {
  console.log(`🚀 PanelKit running on ${config.HOST}:${config.PORT}`);

  Bun.serve<WsData>({
    port: config.PORT,
    hostname: config.HOST,
    fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket: real-time stats streaming
      if (url.pathname === "/ws/stats") {
        if (server.upgrade(req, { data: { type: "stats" as const } })) return;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      // WebSocket: terminal
      if (url.pathname === "/ws/terminal") {
        if (server.upgrade(req, { data: { type: "terminal" as const } })) return;
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      return app.fetch(req, server);
    },
    websocket: {
      open(ws) {
        if (ws.data.type === "stats") {
          statsClients.add(ws);
          startStatsInterval();

          // Send initial stats immediately
          getTransformedStats()
            .then((stats) => {
              try {
                ws.send(JSON.stringify(stats));
              } catch {
                // client may have disconnected
              }
            })
            .catch(() => {});
        }

        if (ws.data.type === "terminal") {
          try {
            const shell = Bun.spawn(["bash"], {
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            });

            ws.data.shellProcess = shell;

            // Stream stdout to WebSocket
            const readStream = async (
              stream: ReadableStream<Uint8Array> | null,
              label: string
            ) => {
              if (!stream) return;
              const reader = stream.getReader();
              const decoder = new TextDecoder();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  try {
                    ws.send(decoder.decode(value, { stream: true }));
                  } catch {
                    break;
                  }
                }
              } catch {
                // stream ended
              } finally {
                reader.releaseLock();
              }
            };

            // Read both stdout and stderr concurrently
            ws.data.readLoop = Promise.all([
              readStream(shell.stdout as ReadableStream<Uint8Array>, "stdout"),
              readStream(shell.stderr as ReadableStream<Uint8Array>, "stderr"),
            ]).then(() => {});
          } catch {
            ws.send(JSON.stringify({ error: "Failed to spawn shell" }));
            ws.close();
          }
        }
      },
      close(ws) {
        if (ws.data.type === "stats") {
          statsClients.delete(ws);
          if (statsClients.size === 0) {
            stopStatsInterval();
          }
        }

        if (ws.data.type === "terminal") {
          const shell = ws.data.shellProcess;
          if (shell) {
            try {
              shell.kill();
            } catch {
              // process may already be dead
            }
          }
        }
      },
      message(ws, msg) {
        if (ws.data.type === "terminal") {
          const shell = ws.data.shellProcess;
          if (shell && shell.stdin) {
            const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
            const writer = shell.stdin.getWriter();
            writer.write(new TextEncoder().encode(text));
            writer.releaseLock();
          }
        }

        if (ws.data.type === "stats") {
          // Stats WebSocket is read-only; ignore client messages
        }
      },
    },
  });
}
