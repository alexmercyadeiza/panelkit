import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Backup {
  id: string;
  type: string;
  timestamp: string;
  size: number;
  checksum?: string;
  description?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateId(id: string, len = 12): string {
  return id.length > len ? id.slice(0, len) + "..." : id;
}

// ─── Backups Page ───────────────────────────────────────────────────────────

export function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ backups: Backup[] }>("/backups");
      setBackups(data.backups ?? []);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load backups"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      await api("/backups", {
        method: "POST",
        body: JSON.stringify({ type: "manual" }),
      });
      await fetchBackups();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create backup"
      );
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    setError(null);
    try {
      await api(`/backups/${id}/restore`, { method: "POST" });
      setConfirmRestoreId(null);
      await fetchBackups();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to restore backup"
      );
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await api(`/backups/${id}`, { method: "DELETE" });
      setConfirmDeleteId(null);
      await fetchBackups();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete backup"
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleRotate = async () => {
    setRotating(true);
    setError(null);
    try {
      await api("/backups/rotate", { method: "POST" });
      await fetchBackups();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to rotate backups"
      );
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Backups</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Create, restore, and manage server backups
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleRotate}
            loading={rotating}
          >
            Rotate Backups
          </Button>
          <Button variant="primary" onClick={handleCreate} loading={creating}>
            Create Backup
          </Button>
        </div>
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
          <div className="text-sm text-zinc-500">Loading backups...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && backups.length === 0 && (
        <EmptyState
          title="No backups yet"
          description="Create your first backup to protect your server data and configurations."
          action={{
            label: "Create Backup",
            onClick: handleCreate,
          }}
        />
      )}

      {/* Backups table */}
      {!loading && backups.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    ID
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Timestamp
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Size
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Checksum
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr
                    key={backup.id}
                    className="border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/60 transition-colors duration-75"
                  >
                    <td
                      className="px-4 py-3 text-sm text-zinc-300 font-mono-code"
                      title={backup.id}
                    >
                      {truncateId(backup.id)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          backup.type === "manual"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-purple-500/10 text-purple-400"
                        }`}
                      >
                        {backup.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {formatDate(backup.timestamp)}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">
                      {formatSize(backup.size)}
                    </td>
                    <td
                      className="px-4 py-3 text-sm text-zinc-500 font-mono-code"
                      title={backup.checksum}
                    >
                      {backup.checksum
                        ? truncateId(backup.checksum, 16)
                        : (
                            <span className="text-zinc-600">--</span>
                          )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-1">
                        {/* Restore */}
                        {confirmRestoreId === backup.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">
                              Restore?
                            </span>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleRestore(backup.id)}
                              loading={restoringId === backup.id}
                            >
                              Confirm
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmRestoreId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirmRestoreId(backup.id)}
                          >
                            Restore
                          </Button>
                        )}

                        {/* Delete */}
                        {confirmDeleteId === backup.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">Sure?</span>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDelete(backup.id)}
                              loading={deletingId === backup.id}
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
                            onClick={() => setConfirmDeleteId(backup.id)}
                            className="text-red-400 hover:text-red-300"
                          >
                            Delete
                          </Button>
                        )}
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
