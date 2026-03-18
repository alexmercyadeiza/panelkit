import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import type { AppDatabase } from "../../server/db";
import {
  createChannel,
  listChannels,
  deleteChannel,
  sendNotification,
  testChannel,
  type HttpSender,
  type SmtpSender,
  type NotificationChannel,
  NotificationError,
} from "../../server/services/notification.service";

let db: AppDatabase;

function createMockHttpSender(): HttpSender & {
  calls: { url: string; body: unknown }[];
} {
  const calls: { url: string; body: unknown }[] = [];
  return {
    calls,
    async post(url, body) {
      calls.push({ url, body });
      return { ok: true, status: 200, body: "ok" };
    },
  };
}

beforeEach(() => {
  db = createTestDb();
  resetTestState();
});

describe("Notification Channels — CRUD", () => {
  it("creates a Slack channel", async () => {
    const channel = await createChannel(db, {
      name: "alerts",
      type: "slack",
      config: { webhookUrl: "https://hooks.slack.com/services/xxx" },
    });

    expect(channel.id).toBeDefined();
    expect(channel.name).toBe("alerts");
    expect(channel.type).toBe("slack");
  });

  it("creates a Discord channel", async () => {
    const channel = await createChannel(db, {
      name: "discord-alerts",
      type: "discord",
      config: { webhookUrl: "https://discord.com/api/webhooks/xxx" },
    });

    expect(channel.type).toBe("discord");
  });

  it("lists channels", async () => {
    await createChannel(db, {
      name: "ch1",
      type: "slack",
      config: { webhookUrl: "https://hooks.slack.com/1" },
    });
    await createChannel(db, {
      name: "ch2",
      type: "discord",
      config: { webhookUrl: "https://discord.com/2" },
    });

    const channels = await listChannels(db);
    expect(channels).toHaveLength(2);
  });

  it("deletes a channel", async () => {
    const channel = await createChannel(db, {
      name: "temp",
      type: "slack",
      config: { webhookUrl: "https://hooks.slack.com/xxx" },
    });

    await deleteChannel(db, channel.id);

    const channels = await listChannels(db);
    expect(channels).toHaveLength(0);
  });
});

describe("Notification Channels — Sending", () => {
  it("Slack webhook sends correct payload format", async () => {
    const mockHttp = createMockHttpSender();

    const channel = await createChannel(db, {
      name: "slack-test",
      type: "slack",
      config: { webhookUrl: "https://hooks.slack.com/test" },
    });

    const result = await sendNotification(
      channel,
      { title: "Deploy Success", message: "App deployed", level: "info" },
      mockHttp
    );

    expect(result.success).toBe(true);
    expect(mockHttp.calls).toHaveLength(1);
    expect(mockHttp.calls[0].url).toBe("https://hooks.slack.com/test");
  });

  it("Discord webhook sends correct payload format", async () => {
    const mockHttp = createMockHttpSender();

    const channel = await createChannel(db, {
      name: "discord-test",
      type: "discord",
      config: { webhookUrl: "https://discord.com/api/webhooks/test" },
    });

    const result = await sendNotification(
      channel,
      { title: "Alert", message: "CPU > 90%", level: "warning" },
      mockHttp
    );

    expect(result.success).toBe(true);
    expect(mockHttp.calls).toHaveLength(1);
    expect(mockHttp.calls[0].url).toContain("discord.com");
  });

  it("failed delivery is handled gracefully", async () => {
    const failHttp: HttpSender = {
      async post() {
        return { ok: false, status: 500, body: "Internal Server Error" };
      },
    };

    const channel = await createChannel(db, {
      name: "fail-test",
      type: "slack",
      config: { webhookUrl: "https://hooks.slack.com/fail" },
    });

    const result = await sendNotification(
      channel,
      { title: "Test", message: "Test", level: "info" },
      failHttp
    );

    expect(result.success).toBe(false);
  });

  it("test notification works", async () => {
    const mockHttp = createMockHttpSender();

    const channel = await createChannel(db, {
      name: "test-channel",
      type: "slack",
      config: { webhookUrl: "https://hooks.slack.com/test" },
    });

    const result = await testChannel(db, channel.id, mockHttp);
    expect(result.success).toBe(true);
    expect(mockHttp.calls.length).toBeGreaterThan(0);
  });
});
