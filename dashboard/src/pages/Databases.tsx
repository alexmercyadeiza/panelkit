import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { Select } from "../components/ui/Select";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Database {
  id: string;
  name: string;
  type: "mysql" | "postgresql";
  dbName: string;
  username: string;
  host: string;
  port: number;
  createdAt: string;
}

interface DatabaseInfo extends Database {
  connectionString?: string;
  externalConnectionString?: string;
  password?: string;
}

interface TableInfo {
  name: string;
  rows?: number;
  size?: string;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
}

type View = "list" | "create" | "detail";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function DatabaseTypeIcon({ type }: { type: "mysql" | "postgresql" }) {
  if (type === "postgresql") {
    return (
      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-blue-400"
        >
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14a9 3 0 0 0 18 0V5" />
          <path d="M3 12a9 3 0 0 0 18 0" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-orange-400"
      >
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </svg>
    </div>
  );
}

// ─── Create Database Form ─────────────────────────────────────────────────────

function CreateDatabaseForm({
  onCreated,
  onCancel,
}: {
  onCreated: (info: DatabaseInfo) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"mysql" | "postgresql">("postgresql");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ database: DatabaseInfo }>("/databases", {
        method: "POST",
        body: JSON.stringify({ name, type }),
      });
      onCreated(data.database);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create database"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Create Database</h2>
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
            Database Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_database"
            required
            pattern="^[a-zA-Z_][a-zA-Z0-9_-]*$"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
          />
          <p className="text-xs text-zinc-600 mt-1">
            Letters, numbers, underscores, and hyphens
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Database Type
          </label>
          <Select
            value={type}
            onChange={(v) => setType(v as "mysql" | "postgresql")}
            options={[
              { value: "postgresql", label: "PostgreSQL" },
              { value: "mysql", label: "MySQL" },
            ]}
          />
        </div>

        <div className="pt-2">
          <Button type="submit" variant="primary" loading={saving}>
            Create Database
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Connection String Display ────────────────────────────────────────────────

function ConnectionString({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div>
      <span className="text-xs text-zinc-500 block mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 font-mono-code overflow-x-auto whitespace-nowrap">
          {value}
        </code>
        <button
          onClick={handleCopy}
          className="p-2 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0 bg-zinc-950 border border-zinc-800 rounded-lg"
          title="Copy to clipboard"
        >
          {copied ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-400"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── SQL Query Runner ─────────────────────────────────────────────────────────

function QueryRunner({ dbId }: { dbId: string }) {
  const [query, setQuery] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!query.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await api<{ result: QueryResult }>(
        `/databases/${dbId}/query`,
        {
          method: "POST",
          body: JSON.stringify({ query, readOnly }),
        }
      );
      setResult(data.result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Query failed");
    } finally {
      setRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-zinc-300">SQL Query Runner</h4>
        <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => setReadOnly(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-900 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
          />
          Read-only
        </label>
      </div>

      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="SELECT * FROM ..."
        rows={4}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono-code resize-y"
      />

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="sm"
          onClick={handleRun}
          loading={running}
          disabled={!query.trim()}
        >
          Run Query
        </Button>
        <span className="text-xs text-zinc-600">Cmd+Enter to run</span>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400 font-mono-code">{error}</p>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="font-mono-code">
              {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}
            </span>
            <span className="font-mono-code">{result.duration}ms</span>
          </div>
          {result.columns.length > 0 && result.rows.length > 0 ? (
            <DataTable
              columns={result.columns.map((col) => ({
                key: col,
                label: col,
                mono: true,
              }))}
              data={result.rows}
            />
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
              <p className="text-sm text-zinc-500">
                Query executed successfully. No rows returned.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Database Detail View ─────────────────────────────────────────────────────

function DatabaseDetailView({
  db,
  onBack,
  onDeleted,
}: {
  db: Database;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [infoLoading, setInfoLoading] = useState(true);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInfo() {
      setInfoLoading(true);
      try {
        const data = await api<{ database: DatabaseInfo }>(
          `/databases/${db.id}/info`
        );
        setInfo(data.database);
      } catch {
        // use base db info
        setInfo(db as DatabaseInfo);
      } finally {
        setInfoLoading(false);
      }
    }

    async function fetchTables() {
      setTablesLoading(true);
      try {
        const data = await api<{ tables: TableInfo[] }>(
          `/databases/${db.id}/tables`
        );
        setTables(data.tables);
      } catch {
        setTables([]);
      } finally {
        setTablesLoading(false);
      }
    }

    fetchInfo();
    fetchTables();
  }, [db]);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api(`/databases/${db.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete database"
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
        <DatabaseTypeIcon type={db.type} />
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-white truncate">
            {db.name}
          </h2>
          <p className="text-sm text-zinc-500 capitalize">{db.type}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Connection Info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
            Connection Details
          </h3>
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
              Delete Database
            </Button>
          )}
        </div>

        {infoLoading ? (
          <p className="text-sm text-zinc-500">Loading connection info...</p>
        ) : info ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <span className="text-xs text-zinc-500 block">Host</span>
                <span className="text-sm text-white font-mono-code">
                  {info.host}
                </span>
              </div>
              <div>
                <span className="text-xs text-zinc-500 block">Port</span>
                <span className="text-sm text-white font-mono-code">
                  {info.port}
                </span>
              </div>
              <div>
                <span className="text-xs text-zinc-500 block">Database</span>
                <span className="text-sm text-white font-mono-code">
                  {info.dbName}
                </span>
              </div>
              <div>
                <span className="text-xs text-zinc-500 block">Username</span>
                <span className="text-sm text-white font-mono-code">
                  {info.username}
                </span>
              </div>
            </div>

            {info.connectionString && (
              <ConnectionString
                label="Connection String"
                value={info.connectionString}
              />
            )}
            {info.externalConnectionString && (
              <ConnectionString
                label="External Connection String"
                value={info.externalConnectionString}
              />
            )}
          </div>
        ) : null}
      </div>

      {/* Tables */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
          Tables
        </h3>
        {tablesLoading ? (
          <p className="text-sm text-zinc-500">Loading tables...</p>
        ) : tables.length === 0 ? (
          <p className="text-sm text-zinc-500">No tables found</p>
        ) : (
          <div className="space-y-1">
            {tables.map((table) => (
              <div
                key={typeof table === "string" ? table : table.name}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-zinc-950/50 border border-zinc-800/50"
              >
                <span className="text-sm text-zinc-300 font-mono-code">
                  {typeof table === "string" ? table : table.name}
                </span>
                {typeof table !== "string" && table.rows != null && (
                  <span className="text-xs text-zinc-600 font-mono-code">
                    {table.rows} rows
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Query Runner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <QueryRunner dbId={db.id} />
      </div>
    </div>
  );
}

// ─── Databases Page ───────────────────────────────────────────────────────────

export function DatabasesPage() {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [selectedDb, setSelectedDb] = useState<Database | null>(null);
  const [createdDbInfo, setCreatedDbInfo] = useState<DatabaseInfo | null>(null);

  const fetchDatabases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ databases: Database[] }>("/databases");
      setDatabases(data.databases);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load databases"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDatabases();
  }, [fetchDatabases]);

  const handleDbCreated = (info: DatabaseInfo) => {
    setCreatedDbInfo(info);
    setView("list");
    fetchDatabases();
  };

  const handleDbClick = (db: Database) => {
    setSelectedDb(db);
    setView("detail");
  };

  const handleDbDeleted = () => {
    setSelectedDb(null);
    setView("list");
    fetchDatabases();
  };

  // ─── Detail view ──────────────────────────────────────────────────────

  if (view === "detail" && selectedDb) {
    return (
      <DatabaseDetailView
        db={selectedDb}
        onBack={() => {
          setView("list");
          fetchDatabases();
        }}
        onDeleted={handleDbDeleted}
      />
    );
  }

  // ─── Create view ─────────────────────────────────────────────────────

  if (view === "create") {
    return (
      <CreateDatabaseForm
        onCreated={handleDbCreated}
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
          <h2 className="text-lg font-semibold text-white">Databases</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage your MySQL and PostgreSQL databases
          </p>
        </div>
        <Button variant="primary" onClick={() => setView("create")}>
          Create Database
        </Button>
      </div>

      {/* Newly created database credentials banner */}
      {createdDbInfo && createdDbInfo.password && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-emerald-400">
                Database Created Successfully
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Save the password now -- it won't be shown again.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreatedDbInfo(null)}
            >
              Dismiss
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-zinc-500 block">Database</span>
              <span className="text-sm text-white font-mono-code">
                {createdDbInfo.dbName}
              </span>
            </div>
            <div>
              <span className="text-xs text-zinc-500 block">Username</span>
              <span className="text-sm text-white font-mono-code">
                {createdDbInfo.username}
              </span>
            </div>
            <div>
              <span className="text-xs text-zinc-500 block">Password</span>
              <span className="text-sm text-white font-mono-code">
                {createdDbInfo.password}
              </span>
            </div>
            <div>
              <span className="text-xs text-zinc-500 block">Port</span>
              <span className="text-sm text-white font-mono-code">
                {createdDbInfo.port}
              </span>
            </div>
          </div>
          {createdDbInfo.connectionString && (
            <ConnectionString
              label="Connection String"
              value={createdDbInfo.connectionString}
            />
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-sm text-zinc-500">Loading databases...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && databases.length === 0 && (
        <EmptyState
          title="No databases"
          description="Create your first managed database. PanelKit supports MySQL and PostgreSQL."
          action={{
            label: "Create Database",
            onClick: () => setView("create"),
          }}
        />
      )}

      {/* Database list */}
      {!loading && databases.length > 0 && (
        <div className="space-y-3">
          {databases.map((db) => (
            <button
              key={db.id}
              onClick={() => handleDbClick(db)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4 text-left hover:border-zinc-700 hover:bg-zinc-900/80 transition-all duration-100 group"
            >
              <DatabaseTypeIcon type={db.type} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors truncate">
                    {db.name}
                  </h3>
                  <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-md uppercase font-medium">
                    {db.type}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-xs text-zinc-500">
                  <span className="font-mono-code">
                    {db.host}:{db.port}
                  </span>
                  <span>{formatDate(db.createdAt)}</span>
                </div>
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-zinc-700 group-hover:text-zinc-500 transition-colors shrink-0"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
