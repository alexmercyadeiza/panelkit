import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("/var/panelkit/data/panelkit.db"),
  DATA_DIR: z.string().default("/var/panelkit"),
  SESSION_TTL_SECONDS: z.coerce.number().default(86400 * 7), // 7 days
  MASTER_KEY: z.string().optional(),
  CADDY_ADMIN_URL: z.string().default("http://localhost:2019"),
  PORT_RANGE_START: z.coerce.number().default(4000),
  PORT_RANGE_END: z.coerce.number().default(5000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = { ...process.env, ...overrides };
  _config = configSchema.parse(env);
  return _config;
}

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}
