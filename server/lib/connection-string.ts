// ─── Connection String Generator ─────────────────────────────────────────────

export type DatabaseType = "mysql" | "postgresql";

export interface ConnectionStringOptions {
  type: DatabaseType;
  username: string;
  password: string;
  host: string;
  port: number;
  dbName: string;
  ssl?: boolean;
}

/**
 * URL-encode special characters in a password for use in connection URIs.
 * Encodes all characters that are not unreserved per RFC 3986.
 */
export function encodePassword(password: string): string {
  return encodeURIComponent(password);
}

/**
 * Build a connection string for MySQL or PostgreSQL.
 */
export function buildConnectionString(opts: ConnectionStringOptions): string {
  const encodedPassword = encodePassword(opts.password);
  const scheme = opts.type === "mysql" ? "mysql" : "postgresql";
  const defaultPort = opts.type === "mysql" ? 3306 : 5432;
  const port = opts.port || defaultPort;

  let connStr = `${scheme}://${opts.username}:${encodedPassword}@${opts.host}:${port}/${opts.dbName}`;

  // Add sslmode for PostgreSQL when SSL is configured
  if (opts.type === "postgresql" && opts.ssl) {
    connStr += "?sslmode=require";
  }

  return connStr;
}

/**
 * Build both internal (localhost) and external (public IP) connection strings.
 */
export function buildConnectionStrings(
  opts: ConnectionStringOptions & { externalHost?: string }
): { internal: string; external?: string } {
  const internal = buildConnectionString({
    ...opts,
    host: "localhost",
  });

  let external: string | undefined;
  if (opts.externalHost) {
    external = buildConnectionString({
      ...opts,
      host: opts.externalHost,
    });
  }

  return { internal, external };
}
