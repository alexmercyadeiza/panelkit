import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationChannel {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

// ─── Add Channel Form ───────────────────────────────────────────────────────

function AddChannelForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"slack" | "discord" | "email">("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpTo, setSmtpTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const config =
        type === "email"
          ? {
              host: smtpHost,
              port: parseInt(smtpPort, 10),
              user: smtpUser,
              pass: smtpPass,
              to: smtpTo,
            }
          : { webhookUrl };

      await api("/notifications/channels", {
        method: "POST",
        body: JSON.stringify({ name, type, config, enabled: true }),
      });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create channel"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">
          Add Notification Channel
        </h3>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Channel Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Alerts"
              required
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Type
            </label>
            <Select
              value={type}
              onChange={(v) => setType(v as "slack" | "discord" | "email")}
              options={[
                { value: "slack", label: "Slack" },
                { value: "discord", label: "Discord" },
                { value: "email", label: "Email (SMTP)" },
              ]}
            />
          </div>
        </div>

        {type !== "email" ? (
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Webhook URL
            </label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={`https://${type === "slack" ? "hooks.slack.com/services/..." : "discord.com/api/webhooks/..."}`}
              required
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  SMTP Host
                </label>
                <input
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.example.com"
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  SMTP Port
                </label>
                <input
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  placeholder="587"
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  SMTP Username
                </label>
                <input
                  type="text"
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  placeholder="alerts@example.com"
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                  SMTP Password
                </label>
                <input
                  type="password"
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  placeholder="********"
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Recipient Email
              </label>
              <input
                type="email"
                value={smtpTo}
                onChange={(e) => setSmtpTo(e.target.value)}
                placeholder="admin@example.com"
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        )}

        <div className="pt-1">
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            Add Channel
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Settings Page ──────────────────────────────────────────────────────────

export function SettingsPage() {
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    success: boolean;
    message: string;
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchChannels = useCallback(async () => {
    setChannelsLoading(true);
    try {
      const data = await api<{ channels: NotificationChannel[] }>(
        "/notifications/channels"
      );
      setChannels(data.channels ?? []);
    } catch {
      setChannels([]);
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const handleTestChannel = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      await api(`/notifications/channels/${id}/test`, { method: "POST" });
      setTestResult({ id, success: true, message: "Test notification sent" });
    } catch (err) {
      setTestResult({
        id,
        success: false,
        message:
          err instanceof ApiError ? err.message : "Test notification failed",
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await api(`/notifications/channels/${id}`, { method: "DELETE" });
      setConfirmDeleteId(null);
      await fetchChannels();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete channel"
      );
    } finally {
      setDeletingId(null);
    }
  };

  const channelTypeColors: Record<string, string> = {
    slack: "bg-green-500/10 text-green-400",
    discord: "bg-indigo-500/10 text-indigo-400",
    email: "bg-amber-500/10 text-amber-400",
  };

  return (
    <div className="space-y-8">
      {/* General Section */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-1">General</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Server identification and panel configuration
        </p>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Server Name
            </label>
            <input
              type="text"
              defaultValue="PanelKit Server"
              className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Panel URL
            </label>
            <input
              type="url"
              defaultValue={window.location.origin}
              className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
            />
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-1">Security</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Authentication and access control
        </p>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">
                Two-Factor Authentication
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Add an extra layer of security to your account with TOTP-based
                2FA
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400">
              Coming Soon
            </span>
          </div>
        </div>
      </section>

      {/* Notifications Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">
              Notifications
            </h2>
            <p className="text-sm text-zinc-500">
              Configure notification channels for alerts and events
            </p>
          </div>
          {!showAddChannel && (
            <Button
              variant="secondary"
              onClick={() => setShowAddChannel(true)}
            >
              Add Channel
            </Button>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Add channel form */}
        {showAddChannel && (
          <div className="mb-4">
            <AddChannelForm
              onCreated={() => {
                setShowAddChannel(false);
                fetchChannels();
              }}
              onCancel={() => setShowAddChannel(false)}
            />
          </div>
        )}

        {/* Channels list */}
        {channelsLoading ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-sm text-zinc-500">Loading channels...</p>
          </div>
        ) : channels.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-sm text-zinc-500 mb-1">
              No notification channels configured
            </p>
            <p className="text-xs text-zinc-600">
              Add a Slack, Discord, or email channel to receive alerts
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((channel) => (
              <div
                key={channel.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-medium text-white">
                      {channel.name}
                    </h3>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        channelTypeColors[channel.type] ||
                        "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {channel.type}
                    </span>
                    {!channel.enabled && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-500">
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleTestChannel(channel.id)}
                      loading={testingId === channel.id}
                    >
                      Test
                    </Button>
                    {confirmDeleteId === channel.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-500">Sure?</span>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteChannel(channel.id)}
                          loading={deletingId === channel.id}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDeleteId(channel.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                {testResult && testResult.id === channel.id && (
                  <div
                    className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                      testResult.success
                        ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                        : "bg-red-500/10 border border-red-500/20 text-red-400"
                    }`}
                  >
                    {testResult.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
