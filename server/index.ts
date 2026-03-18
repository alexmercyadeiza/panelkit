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
import { DeployError } from "./services/deploy.service";

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

// Health check
app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
  })
);

// ─── SPA Serving ─────────────────────────────────────────────────────────────

app.use(
  "/assets/*",
  serveStatic({ root: "./dashboard/dist" })
);

app.get("*", serveStatic({ root: "./dashboard/dist", path: "/index.html" }));

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

  Bun.serve({
    port: config.PORT,
    hostname: config.HOST,
    fetch: app.fetch,
  });
}
