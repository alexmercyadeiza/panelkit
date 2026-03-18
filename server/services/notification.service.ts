// ─── Notification Service ───────────────────────────────────────────────────

import { eq } from "drizzle-orm";
import { type AppDatabase } from "../db";
import { notificationChannels } from "../db/schema";
import { generateId } from "./crypto.service";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ChannelType = "slack" | "discord" | "email";

export interface SlackConfig {
  webhookUrl: string;
}

export interface DiscordConfig {
  webhookUrl: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  to: string[];
  username?: string;
  password?: string;
}

export type ChannelConfig = SlackConfig | DiscordConfig | EmailConfig;

export interface NotificationChannel {
  id: string;
  name: string;
  type: ChannelType;
  config: ChannelConfig;
  enabled: boolean;
  createdAt: string;
}

export interface NotificationPayload {
  title: string;
  message: string;
  level: "info" | "success" | "warning" | "error";
  timestamp?: string;
}

export type TriggerCondition =
  | "deploy_success"
  | "deploy_fail"
  | "high_cpu"
  | "disk_full"
  | "health_check_fail"
  | "health_check_recover";

export interface SendResult {
  channelId: string;
  success: boolean;
  error?: string;
}

// ─── Mockable Interfaces ────────────────────────────────────────────────────

export interface HttpSender {
  post(
    url: string,
    body: unknown,
    headers?: Record<string, string>
  ): Promise<{ status: number; body: string }>;
}

export interface SmtpSender {
  sendMail(opts: {
    host: string;
    port: number;
    secure: boolean;
    from: string;
    to: string[];
    subject: string;
    text: string;
    html?: string;
    username?: string;
    password?: string;
  }): Promise<void>;
}

// ─── Default Implementations ────────────────────────────────────────────────

export const defaultHttpSender: HttpSender = {
  async post(url, body, headers = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text };
  },
};

export const defaultSmtpSender: SmtpSender = {
  async sendMail(_opts) {
    // In production, integrate with nodemailer or similar
    throw new NotificationError("SMTP not configured — use a mail transport library", 501);
  },
};

// ─── Channel CRUD ───────────────────────────────────────────────────────────

export async function createChannel(
  db: AppDatabase,
  input: {
    name: string;
    type: ChannelType;
    config: ChannelConfig;
    enabled?: boolean;
  }
): Promise<NotificationChannel> {
  if (!input.name || input.name.trim().length === 0) {
    throw new NotificationError("Channel name is required", 400);
  }

  if (!["slack", "discord", "email"].includes(input.type)) {
    throw new NotificationError("Invalid channel type", 400);
  }

  validateChannelConfig(input.type, input.config);

  const id = generateId();
  const now = new Date().toISOString();

  await db.insert(notificationChannels).values({
    id,
    name: input.name.trim(),
    type: input.type,
    config: JSON.stringify(input.config),
    enabled: input.enabled !== false,
    createdAt: now,
  });

  return {
    id,
    name: input.name.trim(),
    type: input.type,
    config: input.config,
    enabled: input.enabled !== false,
    createdAt: now,
  };
}

export async function listChannels(
  db: AppDatabase
): Promise<NotificationChannel[]> {
  const rows = await db.select().from(notificationChannels);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as ChannelType,
    config: JSON.parse(row.config) as ChannelConfig,
    enabled: row.enabled,
    createdAt: row.createdAt,
  }));
}

export async function getChannel(
  db: AppDatabase,
  id: string
): Promise<NotificationChannel | null> {
  const row = await db.query.notificationChannels.findFirst({
    where: eq(notificationChannels.id, id),
  });

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    type: row.type as ChannelType,
    config: JSON.parse(row.config) as ChannelConfig,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export async function deleteChannel(
  db: AppDatabase,
  id: string
): Promise<boolean> {
  const existing = await db.query.notificationChannels.findFirst({
    where: eq(notificationChannels.id, id),
  });

  if (!existing) {
    throw new NotificationError("Channel not found", 404);
  }

  await db
    .delete(notificationChannels)
    .where(eq(notificationChannels.id, id));

  return true;
}

// ─── Send Notifications ─────────────────────────────────────────────────────

export async function sendNotification(
  channel: NotificationChannel,
  payload: NotificationPayload,
  httpSender: HttpSender = defaultHttpSender,
  smtpSender: SmtpSender = defaultSmtpSender
): Promise<SendResult> {
  const ts = payload.timestamp || new Date().toISOString();

  try {
    switch (channel.type) {
      case "slack":
        await sendSlack(
          channel.config as SlackConfig,
          payload,
          ts,
          httpSender
        );
        break;

      case "discord":
        await sendDiscord(
          channel.config as DiscordConfig,
          payload,
          ts,
          httpSender
        );
        break;

      case "email":
        await sendEmail(
          channel.config as EmailConfig,
          payload,
          ts,
          smtpSender
        );
        break;

      default:
        return {
          channelId: channel.id,
          success: false,
          error: `Unknown channel type: ${channel.type}`,
        };
    }

    return { channelId: channel.id, success: true };
  } catch (err: any) {
    return {
      channelId: channel.id,
      success: false,
      error: err.message || "Send failed",
    };
  }
}

async function sendSlack(
  config: SlackConfig,
  payload: NotificationPayload,
  timestamp: string,
  httpSender: HttpSender
): Promise<void> {
  const levelEmoji: Record<string, string> = {
    info: ":information_source:",
    success: ":white_check_mark:",
    warning: ":warning:",
    error: ":x:",
  };

  const slackPayload = {
    text: `${levelEmoji[payload.level] || ""} *${payload.title}*`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${levelEmoji[payload.level] || ""} *${payload.title}*\n${payload.message}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `PanelKit | ${timestamp}`,
          },
        ],
      },
    ],
  };

  const result = await httpSender.post(config.webhookUrl, slackPayload);

  if (result.status < 200 || result.status >= 300) {
    throw new NotificationError(
      `Slack webhook returned ${result.status}: ${result.body}`,
      502
    );
  }
}

async function sendDiscord(
  config: DiscordConfig,
  payload: NotificationPayload,
  timestamp: string,
  httpSender: HttpSender
): Promise<void> {
  const colorMap: Record<string, number> = {
    info: 0x3498db,
    success: 0x2ecc71,
    warning: 0xf39c12,
    error: 0xe74c3c,
  };

  const discordPayload = {
    embeds: [
      {
        title: payload.title,
        description: payload.message,
        color: colorMap[payload.level] || 0x95a5a6,
        timestamp,
        footer: {
          text: "PanelKit",
        },
      },
    ],
  };

  const result = await httpSender.post(config.webhookUrl, discordPayload);

  if (result.status < 200 || result.status >= 300) {
    throw new NotificationError(
      `Discord webhook returned ${result.status}: ${result.body}`,
      502
    );
  }
}

async function sendEmail(
  config: EmailConfig,
  payload: NotificationPayload,
  timestamp: string,
  smtpSender: SmtpSender
): Promise<void> {
  const subject = `[PanelKit] [${payload.level.toUpperCase()}] ${payload.title}`;
  const text = `${payload.title}\n\n${payload.message}\n\nTimestamp: ${timestamp}`;
  const html = `<h2>${payload.title}</h2><p>${payload.message}</p><p><small>${timestamp}</small></p>`;

  await smtpSender.sendMail({
    host: config.host,
    port: config.port,
    secure: config.secure,
    from: config.from,
    to: config.to,
    subject,
    text,
    html,
    username: config.username,
    password: config.password,
  });
}

// ─── Test Notification ──────────────────────────────────────────────────────

export async function testChannel(
  db: AppDatabase,
  channelId: string,
  httpSender: HttpSender = defaultHttpSender,
  smtpSender: SmtpSender = defaultSmtpSender
): Promise<SendResult> {
  const channel = await getChannel(db, channelId);

  if (!channel) {
    throw new NotificationError("Channel not found", 404);
  }

  const testPayload: NotificationPayload = {
    title: "PanelKit Test Notification",
    message: "This is a test notification from PanelKit. If you see this, your notification channel is configured correctly.",
    level: "info",
  };

  return sendNotification(channel, testPayload, httpSender, smtpSender);
}

// ─── Trigger Notifications ──────────────────────────────────────────────────

export async function triggerNotification(
  db: AppDatabase,
  condition: TriggerCondition,
  payload: NotificationPayload,
  httpSender: HttpSender = defaultHttpSender,
  smtpSender: SmtpSender = defaultSmtpSender
): Promise<SendResult[]> {
  // Send to all enabled channels
  const channels = await listChannels(db);
  const enabledChannels = channels.filter((ch) => ch.enabled);

  const results: SendResult[] = [];

  for (const channel of enabledChannels) {
    const result = await sendNotification(
      channel,
      payload,
      httpSender,
      smtpSender
    );
    results.push(result);
  }

  return results;
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateChannelConfig(type: ChannelType, config: ChannelConfig): void {
  switch (type) {
    case "slack": {
      const c = config as SlackConfig;
      if (!c.webhookUrl) {
        throw new NotificationError("Slack webhook URL is required", 400);
      }
      break;
    }
    case "discord": {
      const c = config as DiscordConfig;
      if (!c.webhookUrl) {
        throw new NotificationError("Discord webhook URL is required", 400);
      }
      break;
    }
    case "email": {
      const c = config as EmailConfig;
      if (!c.host || !c.from || !c.to || c.to.length === 0) {
        throw new NotificationError(
          "Email config requires host, from, and at least one recipient",
          400
        );
      }
      break;
    }
  }
}

// ─── Error Class ────────────────────────────────────────────────────────────

export class NotificationError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "NotificationError";
  }
}
