import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { StatusBadge } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";
import { Select } from "../components/ui/Select";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  command: string;
  type: "command" | "http";
  httpUrl?: string;
  httpMethod?: string;
  enabled: boolean;
  lastRunAt?: string;
  lastStatus?: string;
  createdAt: string;
  updatedAt: string;
}

interface CronExecution {
  id: string;
  cronJobId: string;
  status: string;
  exitCode: number | null;
  output?: string;
  startedAt: string;
  finishedAt?: string;
}

type View = "list" | "create" | "detail" | "edit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function truncate(str: string, max = 40): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}

// ─── Create / Edit Form ──────────────────────────────────────────────────────

function CronJobForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: CronJob;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [schedule, setSchedule] = useState(initial?.schedule ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [type, setType] = useState<"command" | "http">(initial?.type ?? "command");
  const [httpUrl, setHttpUrl] = useState(initial?.httpUrl ?? "");
  const [httpMethod, setHttpMethod] = useState(initial?.httpMethod ?? "GET");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { name, schedule, command, type, enabled };
      if (type === "http") {
        payload.httpUrl = httpUrl;
        payload.httpMethod = httpMethod;
      }
      if (isEdit) {
        await api(`/cron/${initial.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/cron", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save cron job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">
          {isEdit ? "Edit Cron Job" : "Create Cron Job"}
        </h2>
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
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="backup-database"
            required
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Schedule</label>
          <input
            type="text"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="*/5 * * * *"
            required
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
          />
          <p className="text-xs text-zinc-600 mt-1">
            e.g. <span className="font-mono-code">*/5 * * * *</span> (every 5 minutes)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Command</label>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="/usr/local/bin/backup.sh"
            required
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">Type</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setType("command")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                type === "command"
                  ? "bg-blue-600/20 text-blue-400 border-blue-500/30"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-300"
              }`}
            >
              Command
            </button>
            <button
              type="button"
              onClick={() => setType("http")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                type === "http"
                  ? "bg-blue-600/20 text-blue-400 border-blue-500/30"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-300"
              }`}
            >
              HTTP
            </button>
          </div>
        </div>

        {type === "http" && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">HTTP URL</label>
              <input
                type="url"
                value={httpUrl}
                onChange={(e) => setHttpUrl(e.target.value)}
                placeholder="https://example.com/webhook"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Method</label>
              <Select
                value={httpMethod}
                onChange={(v) => setHttpMethod(v)}
                options={[
                  { value: "GET", label: "GET" },
                  { value: "POST", label: "POST" },
                  { value: "PUT", label: "PUT" },
                  { value: "DELETE", label: "DELETE" },
                  { value: "PATCH", label: "PATCH" },
                ]}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-zinc-700 rounded-full peer peer-checked:bg-blue-600 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
          </label>
          <span className="text-sm text-zinc-300">Enabled</span>
        </div>

        <div className="pt-2">
          <Button type="submit" variant="primary" loading={saving}>
            {isEdit ? "Save Changes" : "Create Job"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Job Detail View ─────────────────────────────────────────────────────────

function JobDetailView({
  job,
  onBack,
  onEdit,
  onRefresh,
}: {
  job: CronJob;
  onBack: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const [history, setHistory] = useState<CronExecution[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await api<{ history: CronExecution[] }>(`/cron/${job.id}/history?limit=20`);
      setHistory(data.history ?? []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [job.id]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleRunNow = async () => {
    setRunning(true);
    setError(null);
    try {
      await api(`/cron/${job.id}/run`, { method: "POST" });
      fetchHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to run job");
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api(`/cron/${job.id}`, { method: "DELETE" });
      onRefresh();
      onBack();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete job");
      setDeleting(false);
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
            <h2 className="text-lg font-semibold text-white">{job.name}</h2>
            <p className="text-xs text-zinc-500 font-mono-code">{job.schedule}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={handleRunNow} loading={running}>
            Run Now
          </Button>
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Edit
          </Button>
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <Button variant="danger" size="sm" onClick={handleDelete} loading={deleting}>
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

      {/* Job Info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Type</span>
            <div className="mt-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                job.type === "http"
                  ? "bg-violet-500/10 text-violet-400"
                  : "bg-blue-500/10 text-blue-400"
              }`}>
                {job.type}
              </span>
            </div>
          </div>
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Status</span>
            <div className="mt-1">
              <StatusBadge status={job.enabled ? "active" : "stopped"} />
            </div>
          </div>
          <div>
            <span className="text-xs text-zinc-500 uppercase tracking-wide">Command</span>
            <p className="text-sm text-zinc-300 font-mono-code mt-1 break-all">{job.command}</p>
          </div>
          {job.type === "http" && job.httpUrl && (
            <div>
              <span className="text-xs text-zinc-500 uppercase tracking-wide">HTTP</span>
              <p className="text-sm text-zinc-300 font-mono-code mt-1 break-all">
                {job.httpMethod ?? "GET"} {job.httpUrl}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Execution History */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">
          Execution History
        </h3>
        {historyLoading ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-sm text-zinc-500">Loading history...</p>
          </div>
        ) : history.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-sm text-zinc-500">No executions yet</p>
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Timestamp</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Exit Code</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((exec) => {
                    const duration = exec.finishedAt && exec.startedAt
                      ? ((new Date(exec.finishedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000).toFixed(1) + "s"
                      : "--";
                    return (
                      <tr key={exec.id} className="border-b border-zinc-800/50 last:border-b-0">
                        <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">
                          {new Date(exec.startedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <StatusBadge status={exec.status} />
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">
                          {exec.exitCode != null ? exec.exitCode : "--"}
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">
                          {duration}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CronJobsPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ jobs: CronJob[] }>("/cron");
      setJobs(data.jobs ?? []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const handleJobCreated = () => {
    setView("list");
    fetchJobs();
  };

  const handleSelectJob = (job: CronJob) => {
    setSelectedJob(job);
    setView("detail");
  };

  const handleEditJob = () => {
    setView("edit");
  };

  // ─── Create View ──────────────────────────────────────────────────────────
  if (view === "create") {
    return (
      <CronJobForm
        onSaved={handleJobCreated}
        onCancel={() => setView("list")}
      />
    );
  }

  // ─── Edit View ────────────────────────────────────────────────────────────
  if (view === "edit" && selectedJob) {
    return (
      <CronJobForm
        initial={selectedJob}
        onSaved={() => {
          setView("list");
          fetchJobs();
        }}
        onCancel={() => setView("detail")}
      />
    );
  }

  // ─── Detail View ──────────────────────────────────────────────────────────
  if (view === "detail" && selectedJob) {
    return (
      <JobDetailView
        job={selectedJob}
        onBack={() => {
          setSelectedJob(null);
          setView("list");
        }}
        onEdit={handleEditJob}
        onRefresh={fetchJobs}
      />
    );
  }

  // ─── List View ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Cron Jobs</h2>
        <Button variant="primary" size="md" onClick={() => setView("create")}>
          Create Job
        </Button>
      </div>

      {/* Job List */}
      {loading ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-16 flex items-center justify-center">
          <p className="text-sm text-zinc-500">Loading cron jobs...</p>
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="No Cron Jobs"
          description="Create your first cron job to schedule automated tasks."
          action={{ label: "Create Job", onClick: () => setView("create") }}
        />
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Schedule</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Command</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Last Run</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">Last Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() => handleSelectJob(job)}
                    className="border-b border-zinc-800/50 last:border-b-0 cursor-pointer hover:bg-zinc-800/60 transition-colors duration-75"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-white">{job.name}</td>
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">{job.schedule}</td>
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">{truncate(job.command)}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        job.type === "http"
                          ? "bg-violet-500/10 text-violet-400"
                          : "bg-blue-500/10 text-blue-400"
                      }`}>
                        {job.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <StatusBadge status={job.enabled ? "active" : "stopped"} />
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {job.lastRunAt ? timeAgo(job.lastRunAt) : <span className="text-zinc-600">--</span>}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {job.lastStatus ? (
                        <StatusBadge status={job.lastStatus} />
                      ) : (
                        <span className="text-zinc-600">--</span>
                      )}
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
