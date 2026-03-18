import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { StatusBadge } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PM2Process {
  name: string;
  pid: number;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  exec_mode: string;
  instances?: number;
  pm_id?: number;
}

interface ProcessLogs {
  out: string;
  err: string;
}

type View = "list" | "create" | "detail";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMemory(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ─── Start Process Form ──────────────────────────────────────────────────────

function StartProcessForm({
  onStarted,
  onCancel,
}: {
  onStarted: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [instances, setInstances] = useState("1");
  const [execMode, setExecMode] = useState<"fork" | "cluster">("fork");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("/pm2/processes", {
        method: "POST",
        body: JSON.stringify({
          name,
          script,
          instances: parseInt(instances, 10),
          exec_mode: execMode,
        }),
      });
      onStarted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start process");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Start New Process</h2>
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
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Process Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-app"
            required
            pattern="^[a-zA-Z0-9][a-zA-Z0-9._-]*$"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-xs text-zinc-600 mt-1">
            Alphanumeric with dots, dashes, or underscores
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Script Path</label>
          <input
            type="text"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="/home/user/app/server.js"
            required
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Instances</label>
            <input
              type="number"
              value={instances}
              onChange={(e) => setInstances(e.target.value)}
              min="1"
              max="16"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Exec Mode</label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setExecMode("fork")}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                  execMode === "fork"
                    ? "bg-blue-600/20 text-blue-400 border-blue-500/30"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-300"
                }`}
              >
                Fork
              </button>
              <button
                type="button"
                onClick={() => setExecMode("cluster")}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                  execMode === "cluster"
                    ? "bg-blue-600/20 text-blue-400 border-blue-500/30"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-300"
                }`}
              >
                Cluster
              </button>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <Button type="submit" variant="primary" loading={saving}>
            Start Process
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Process Detail View ─────────────────────────────────────────────────────

function ProcessDetailView({
  process: proc,
  onBack,
  onRefresh,
}: {
  process: PM2Process;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [logs, setLogs] = useState<ProcessLogs | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await api<{ logs: ProcessLogs }>(`/pm2/processes/${encodeURIComponent(proc.name)}/logs?lines=100`);
      setLogs(data.logs);
    } catch {
      setLogs(null);
    } finally {
      setLogsLoading(false);
    }
  }, [proc.name]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleAction = async (action: "restart" | "stop" | "delete") => {
    setActionLoading(action);
    setError(null);
    try {
      if (action === "delete") {
        await api(`/pm2/processes/${encodeURIComponent(proc.name)}`, { method: "DELETE" });
        onRefresh();
        onBack();
        return;
      }
      await api(`/pm2/processes/${encodeURIComponent(proc.name)}/${action}`, { method: "PUT" });
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${action} process`);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div>
            <h2 className="text-lg font-semibold text-white">{proc.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusBadge status={proc.status} />
              <span className="text-xs text-zinc-500 font-mono-code">PID {proc.pid}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleAction("restart")}
            loading={actionLoading === "restart"}
          >
            Restart
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleAction("stop")}
            loading={actionLoading === "stop"}
          >
            Stop
          </Button>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleAction("delete")}
                loading={actionLoading === "delete"}
              >
                Confirm Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Process Info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wide">CPU</span>
            <p className="text-lg font-semibold text-white font-mono-code mt-1">{proc.cpu}%</p>
          </div>
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Memory</span>
            <p className="text-lg font-semibold text-white font-mono-code mt-1">{formatMemory(proc.memory)}</p>
          </div>
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Uptime</span>
            <p className="text-lg font-semibold text-white font-mono-code mt-1">{formatUptime(proc.uptime)}</p>
          </div>
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Restarts</span>
            <p className="text-lg font-semibold text-white font-mono-code mt-1">{proc.restarts}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-zinc-800">
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Mode</span>
            <p className="text-sm text-zinc-300 mt-1">{proc.exec_mode}</p>
          </div>
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wide">PID</span>
            <p className="text-sm text-zinc-300 font-mono-code mt-1">{proc.pid}</p>
          </div>
          {proc.pm_id != null && (
            <div>
              <span className="text-xs text-zinc-500 uppercase tracking-wide">PM2 ID</span>
              <p className="text-sm text-zinc-300 font-mono-code mt-1">{proc.pm_id}</p>
            </div>
          )}
          {proc.instances != null && (
            <div>
              <span className="text-xs text-zinc-500 uppercase tracking-wide">Instances</span>
              <p className="text-sm text-zinc-300 font-mono-code mt-1">{proc.instances}</p>
            </div>
          )}
        </div>
      </div>

      {/* Logs */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
            Logs
          </h3>
          <Button variant="ghost" size="sm" onClick={fetchLogs}>
            Refresh Logs
          </Button>
        </div>
        {logsLoading ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-sm text-zinc-500">Loading logs...</p>
          </div>
        ) : logs ? (
          <div className="space-y-4">
            {logs.out && (
              <div>
                <span className="text-xs text-zinc-500 uppercase tracking-wide mb-2 block">stdout</span>
                <pre className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-xs text-zinc-300 font-mono-code overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-all">
                  {logs.out || "No output"}
                </pre>
              </div>
            )}
            {logs.err && (
              <div>
                <span className="text-xs text-red-400/70 uppercase tracking-wide mb-2 block">stderr</span>
                <pre className="bg-zinc-900 border border-red-900/30 rounded-xl p-4 text-xs text-red-300 font-mono-code overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-all">
                  {logs.err}
                </pre>
              </div>
            )}
            {!logs.out && !logs.err && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
                <p className="text-sm text-zinc-500">No logs available</p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-sm text-zinc-500">Unable to load logs</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ProcessesPage() {
  const [processes, setProcesses] = useState<PM2Process[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [selectedProcess, setSelectedProcess] = useState<PM2Process | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ processes: PM2Process[] }>("/pm2/processes");
      setProcesses(data.processes ?? []);
    } catch {
      setProcesses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProcesses();
  }, [fetchProcesses]);

  const handleAction = async (name: string, action: "restart" | "stop" | "delete") => {
    setActionLoading(`${name}-${action}`);
    setError(null);
    try {
      if (action === "delete") {
        await api(`/pm2/processes/${encodeURIComponent(name)}`, { method: "DELETE" });
      } else {
        await api(`/pm2/processes/${encodeURIComponent(name)}/${action}`, { method: "PUT" });
      }
      fetchProcesses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to ${action} process`);
    } finally {
      setActionLoading(null);
    }
  };

  // ─── Create View ──────────────────────────────────────────────────────────
  if (view === "create") {
    return (
      <StartProcessForm
        onStarted={() => {
          setView("list");
          fetchProcesses();
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  // ─── Detail View ──────────────────────────────────────────────────────────
  if (view === "detail" && selectedProcess) {
    return (
      <ProcessDetailView
        process={selectedProcess}
        onBack={() => {
          setSelectedProcess(null);
          setView("list");
        }}
        onRefresh={fetchProcesses}
      />
    );
  }

  // ─── List View ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Processes</h2>
        <Button variant="primary" size="md" onClick={() => setView("create")}>
          Start Process
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Process List */}
      {loading ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-16 flex items-center justify-center">
          <p className="text-sm text-zinc-500">Loading processes...</p>
        </div>
      ) : processes.length === 0 ? (
        <EmptyState
          title="No Processes"
          description="Start a new process to manage it with PM2."
          action={{ label: "Start Process", onClick: () => setView("create") }}
        />
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">PID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">CPU</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Memory</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Uptime</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Restarts</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Mode</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {processes.map((proc) => (
                  <tr
                    key={proc.name}
                    className="border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/60 transition-colors duration-75"
                  >
                    <td
                      className="px-4 py-3 text-sm font-medium text-white cursor-pointer"
                      onClick={() => { setSelectedProcess(proc); setView("detail"); }}
                    >
                      {proc.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">{proc.pid}</td>
                    <td className="px-4 py-3 text-sm">
                      <StatusBadge status={proc.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">{proc.cpu}%</td>
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">{formatMemory(proc.memory)}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400">{formatUptime(proc.uptime)}</td>
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">{proc.restarts}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400">{proc.exec_mode}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAction(proc.name, "restart")}
                          loading={actionLoading === `${proc.name}-restart`}
                        >
                          Restart
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAction(proc.name, "stop")}
                          loading={actionLoading === `${proc.name}-stop`}
                        >
                          Stop
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleAction(proc.name, "delete")}
                          loading={actionLoading === `${proc.name}-delete`}
                          className="text-red-400 hover:text-red-300"
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
