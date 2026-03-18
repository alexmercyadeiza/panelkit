import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { StatusBadge } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

interface App {
  id: string;
  name: string;
  repoUrl: string;
  branch: string;
  buildCommand: string | null;
  startCommand: string | null;
  dockerfilePath: string | null;
  deployMode: "docker" | "pm2";
  status: string;
  autoDeployEnabled: boolean;
  containerId: string | null;
  port: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Deployment {
  id: string;
  appId: string;
  status: string;
  commitHash: string | null;
  buildLog: string | null;
  createdAt: string;
}

type View = "list" | "create" | "detail";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateUrl(url: string, max = 40): string {
  if (url.length <= max) return url;
  return url.slice(0, max - 3) + "...";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Create App Form ──────────────────────────────────────────────────────────

function CreateAppForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [deployMode, setDeployMode] = useState<"docker" | "pm2">("docker");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/apps", {
        method: "POST",
        body: JSON.stringify({ name, repoUrl, branch, deployMode }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create app");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Deploy New App</h2>
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
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            App Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-app"
            required
            pattern="^[a-z0-9][a-z0-9-]*$"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-xs text-zinc-600 mt-1">
            Lowercase alphanumeric with dashes
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Repository URL
          </label>
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/user/repo.git"
            required
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Branch
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Deploy Mode
            </label>
            <select
              value={deployMode}
              onChange={(e) =>
                setDeployMode(e.target.value as "docker" | "pm2")
              }
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="docker">Docker</option>
              <option value="pm2">PM2</option>
            </select>
          </div>
        </div>

        <div className="pt-2">
          <Button type="submit" variant="primary" loading={saving}>
            Create App
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Env Var Editor ───────────────────────────────────────────────────────────

function EnvVarEditor({ appId }: { appId: string }) {
  const [vars, setVars] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function fetchEnv() {
      setLoading(true);
      try {
        const data = await api<{ vars: Record<string, string> }>(
          `/apps/${appId}/env?reveal=true`
        );
        const entries = Object.entries(data.vars).map(([key, value]) => ({
          key,
          value,
        }));
        setVars(entries.length > 0 ? entries : [{ key: "", value: "" }]);
      } catch {
        setVars([{ key: "", value: "" }]);
      } finally {
        setLoading(false);
      }
    }
    fetchEnv();
  }, [appId]);

  const addRow = () => setVars([...vars, { key: "", value: "" }]);

  const removeRow = (index: number) => {
    const next = vars.filter((_, i) => i !== index);
    setVars(next.length > 0 ? next : [{ key: "", value: "" }]);
  };

  const updateRow = (
    index: number,
    field: "key" | "value",
    val: string
  ) => {
    const next = [...vars];
    next[index] = { ...next[index], [field]: val };
    setVars(next);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const record: Record<string, string> = {};
      for (const v of vars) {
        if (v.key.trim()) record[v.key.trim()] = v.value;
      }
      await api(`/apps/${appId}/env`, {
        method: "POST",
        body: JSON.stringify({ vars: record }),
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save env vars"
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="py-4 text-sm text-zinc-500">Loading env vars...</div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-zinc-300">
          Environment Variables
        </h4>
        <Button variant="ghost" size="sm" onClick={addRow}>
          + Add Variable
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <p className="text-xs text-emerald-400">Saved successfully</p>
        </div>
      )}

      <div className="space-y-2">
        {vars.map((v, i) => (
          <div key={i} className="flex gap-2 items-start">
            <input
              type="text"
              value={v.key}
              onChange={(e) => updateRow(i, "key", e.target.value)}
              placeholder="KEY"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono-code"
            />
            <input
              type="text"
              value={v.value}
              onChange={(e) => updateRow(i, "value", e.target.value)}
              placeholder="value"
              className="flex-[2] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono-code"
            />
            <button
              onClick={() => removeRow(i)}
              className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <Button variant="secondary" size="sm" onClick={handleSave} loading={saving}>
        Save Variables
      </Button>
    </div>
  );
}

// ─── App Detail View ──────────────────────────────────────────────────────────

function AppDetailView({
  app,
  onBack,
  onDeleted,
}: {
  app: App;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [deploying, setDeploying] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);
  const [deployLog, setDeployLog] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [currentApp, setCurrentApp] = useState<App>(app);

  const refreshApp = useCallback(async () => {
    try {
      const data = await api<{ app: App }>(`/apps/${app.id}`);
      setCurrentApp(data.app);
    } catch {
      // keep current
    }
  }, [app.id]);

  const fetchDeployments = useCallback(async () => {
    setDeploymentsLoading(true);
    try {
      const data = await api<{ deployments: Deployment[] }>(
        `/apps/${app.id}/deployments`
      );
      setDeployments(data.deployments);
    } catch {
      setDeployments([]);
    } finally {
      setDeploymentsLoading(false);
    }
  }, [app.id]);

  useEffect(() => {
    fetchDeployments();
  }, [fetchDeployments]);

  const handleDeploy = async () => {
    setDeploying(true);
    setActionError(null);
    setDeployLog(null);
    try {
      await api(`/apps/${app.id}/deploy`, { method: "POST" });
      await refreshApp();
      await fetchDeployments();
    } catch (err) {
      if (err instanceof ApiError && err.data) {
        const d = err.data as { buildLog?: string };
        if (d.buildLog) setDeployLog(d.buildLog);
      }
      setActionError(
        err instanceof ApiError ? err.message : "Deployment failed"
      );
    } finally {
      setDeploying(false);
    }
  };

  const handleRollback = async () => {
    setRollingBack(true);
    setActionError(null);
    try {
      await api(`/apps/${app.id}/rollback`, { method: "POST" });
      await refreshApp();
      await fetchDeployments();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Rollback failed"
      );
    } finally {
      setRollingBack(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setActionError(null);
    try {
      await api(`/apps/${app.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to delete app"
      );
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white truncate">
              {currentApp.name}
            </h2>
            <StatusBadge status={currentApp.status || "unknown"} />
          </div>
          <p className="text-sm text-zinc-500 font-mono-code mt-0.5 truncate">
            {currentApp.repoUrl}
          </p>
        </div>
      </div>

      {actionError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">{actionError}</p>
        </div>
      )}

      {/* App Info Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
          Deployment Info
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <span className="text-xs text-zinc-500 block">Branch</span>
            <span className="text-sm text-white font-mono-code">
              {currentApp.branch}
            </span>
          </div>
          <div>
            <span className="text-xs text-zinc-500 block">Deploy Mode</span>
            <span className="text-sm text-white font-mono-code">
              {currentApp.deployMode}
            </span>
          </div>
          <div>
            <span className="text-xs text-zinc-500 block">Port</span>
            <span className="text-sm text-white font-mono-code">
              {currentApp.port ?? "--"}
            </span>
          </div>
          <div>
            <span className="text-xs text-zinc-500 block">Container</span>
            <span className="text-sm text-white font-mono-code truncate block">
              {currentApp.containerId
                ? currentApp.containerId.slice(0, 12)
                : "--"}
            </span>
          </div>
          <div>
            <span className="text-xs text-zinc-500 block">Auto-Deploy</span>
            <span className="text-sm text-white">
              {currentApp.autoDeployEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <div>
            <span className="text-xs text-zinc-500 block">Last Updated</span>
            <span className="text-sm text-white">
              {timeAgo(currentApp.updatedAt)}
            </span>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t border-zinc-800">
          <Button
            variant="primary"
            size="sm"
            onClick={handleDeploy}
            loading={deploying}
          >
            Deploy
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRollback}
            loading={rollingBack}
          >
            Rollback
          </Button>
          <div className="flex-1" />
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Are you sure?</span>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDelete}
                loading={deleting}
              >
                Confirm Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {/* Deploy Log */}
      {deployLog && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
            Deploy Log
          </h3>
          <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-xs text-zinc-300 font-mono-code overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
            {deployLog}
          </pre>
        </div>
      )}

      {/* Env Vars */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <EnvVarEditor appId={app.id} />
      </div>

      {/* Deployments History */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
          Deployment History
        </h3>
        {deploymentsLoading ? (
          <p className="text-sm text-zinc-500">Loading deployments...</p>
        ) : deployments.length === 0 ? (
          <p className="text-sm text-zinc-500">No deployments yet</p>
        ) : (
          <div className="space-y-2">
            {deployments.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-zinc-950/50 border border-zinc-800/50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={d.status} />
                  {d.commitHash && (
                    <span className="text-xs text-zinc-500 font-mono-code">
                      {d.commitHash.slice(0, 7)}
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-600 shrink-0">
                  {timeAgo(d.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Apps Page ────────────────────────────────────────────────────────────────

export function AppsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [selectedApp, setSelectedApp] = useState<App | null>(null);

  const fetchApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ apps: App[] }>("/apps");
      setApps(data.apps);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load apps");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  const handleAppCreated = () => {
    setView("list");
    fetchApps();
  };

  const handleAppClick = (app: App) => {
    setSelectedApp(app);
    setView("detail");
  };

  const handleAppDeleted = () => {
    setSelectedApp(null);
    setView("list");
    fetchApps();
  };

  // ─── Detail view ──────────────────────────────────────────────────────

  if (view === "detail" && selectedApp) {
    return (
      <AppDetailView
        app={selectedApp}
        onBack={() => {
          setView("list");
          fetchApps();
        }}
        onDeleted={handleAppDeleted}
      />
    );
  }

  // ─── Create view ─────────────────────────────────────────────────────

  if (view === "create") {
    return (
      <CreateAppForm
        onCreated={handleAppCreated}
        onCancel={() => setView("list")}
      />
    );
  }

  // ─── List view ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Apps</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage your deployed applications
          </p>
        </div>
        <Button variant="primary" onClick={() => setView("create")}>
          Deploy New App
        </Button>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-sm text-zinc-500">Loading apps...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && apps.length === 0 && (
        <EmptyState
          title="No apps deployed"
          description="Deploy your first application to get started. Connect a Git repository and PanelKit will handle the rest."
          action={{
            label: "Deploy New App",
            onClick: () => setView("create"),
          }}
        />
      )}

      {/* App cards grid */}
      {!loading && apps.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => handleAppClick(app)}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-left hover:border-zinc-700 hover:bg-zinc-900/80 transition-all duration-100 group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors truncate">
                  {app.name}
                </h3>
                <StatusBadge status={app.status || "unknown"} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                  >
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                  </svg>
                  <span className="font-mono-code truncate">
                    {truncateUrl(app.repoUrl)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                  >
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span className="font-mono-code">{app.branch}</span>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800/50">
                <span className="text-xs text-zinc-600 font-mono-code">
                  {app.deployMode}
                </span>
                <span className="text-xs text-zinc-600">
                  {timeAgo(app.updatedAt)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
