import { type ErrorHandler } from "hono";
import { AuthError } from "../services/auth.service";
import { CaddyError } from "../services/caddy.service";
import { DeployError } from "../services/deploy.service";
import { PortError } from "../lib/port-manager";
import { DatabaseError } from "../services/database.service";
import { StorageError } from "../services/storage.service";
import { CronError } from "../services/cron.service";
import { PM2Error } from "../services/pm2.service";
import { DomainError } from "../services/domain.service";
import { FirewallError } from "../services/firewall.service";
import { TotpError } from "../services/totp.service";
import { BackupError } from "../services/backup.service";
import { NotificationError } from "../services/notification.service";
import { HealthCheckError } from "../services/health-check.service";
import { UsersError } from "../services/users.service";
import { getConfig } from "../config";

export const errorHandler: ErrorHandler = (err, c) => {
  const config = getConfig();

  // Known error types
  if (err instanceof AuthError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof CaddyError) {
    return c.json(
      { error: "Reverse proxy configuration error" },
      err.statusCode as any
    );
  }

  if (err instanceof DeployError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof PortError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof DatabaseError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof StorageError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof CronError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof PM2Error) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof DomainError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof FirewallError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof TotpError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof BackupError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof NotificationError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof HealthCheckError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  if (err instanceof UsersError) {
    return c.json({ error: err.message }, err.statusCode as any);
  }

  // Zod validation errors
  if (err.name === "ZodError") {
    return c.json(
      {
        error: "Validation error",
        details: JSON.parse(err.message),
      },
      400
    );
  }

  // Generic errors — never leak stack traces in production
  console.error("[PanelKit Error]", err);

  return c.json(
    {
      error:
        config.NODE_ENV === "production"
          ? "Internal server error"
          : err.message,
    },
    500
  );
};
