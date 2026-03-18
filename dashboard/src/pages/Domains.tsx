import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
import { StatusBadge } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Domain {
  id: string;
  appId: string;
  domain: string;
  status: string;
  sslStatus: string;
  createdAt: string;
  appName?: string;
}

interface AppOption {
  id: string;
  name: string;
}

interface DnsCheckResult {
  resolved: boolean;
  expectedIp?: string;
  actualIp?: string;
  records?: string[];
  message?: string;
}

type View = "list" | "create";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Add Domain Form ─────────────────────────────────────────────────────────

function AddDomainForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [domain, setDomain] = useState("");
  const [appId, setAppId] = useState("");
  const [apps, setApps] = useState<AppOption[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchApps() {
      setAppsLoading(true);
      try {
        const data = await api<{ apps: AppOption[] }>("/apps");
        setApps(data.apps);
        if (data.apps.length > 0) {
          setAppId(data.apps[0].id);
        }
      } catch {
        setApps([]);
      } finally {
        setAppsLoading(false);
      }
    }
    fetchApps();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appId) {
      setError("Please select an app");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api("/domains", {
        method: "POST",
        body: JSON.stringify({ domain, appId }),
      });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to add domain"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Add Domain</h2>
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
            Domain Name
          </label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
            required
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
          />
          <p className="text-xs text-zinc-600 mt-1">
            Enter the full domain name, e.g. app.example.com
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Linked App
          </label>
          {appsLoading ? (
            <p className="text-sm text-zinc-500">Loading apps...</p>
          ) : apps.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No apps available. Create an app first.
            </p>
          ) : (
            <select
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              {apps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="pt-2">
          <Button
            type="submit"
            variant="primary"
            loading={saving}
            disabled={apps.length === 0}
          >
            Add Domain
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── DNS Check Result Display ────────────────────────────────────────────────

function DnsCheckDisplay({ result }: { result: DnsCheckResult }) {
  return (
    <div
      className={`rounded-lg px-4 py-3 text-sm space-y-1 ${
        result.resolved
          ? "bg-emerald-500/10 border border-emerald-500/20"
          : "bg-amber-500/10 border border-amber-500/20"
      }`}
    >
      <p
        className={
          result.resolved ? "text-emerald-400" : "text-amber-400"
        }
      >
        {result.resolved ? "DNS is correctly configured" : "DNS not yet configured"}
      </p>
      {result.message && (
        <p className="text-xs text-zinc-400">{result.message}</p>
      )}
      {result.expectedIp && (
        <p className="text-xs text-zinc-500">
          Expected:{" "}
          <span className="font-mono-code text-zinc-400">
            {result.expectedIp}
          </span>
        </p>
      )}
      {result.actualIp && (
        <p className="text-xs text-zinc-500">
          Resolved:{" "}
          <span className="font-mono-code text-zinc-400">
            {result.actualIp}
          </span>
        </p>
      )}
      {result.records && result.records.length > 0 && (
        <div className="text-xs text-zinc-500 pt-1">
          <span>Records: </span>
          {result.records.map((r, i) => (
            <span key={i} className="font-mono-code text-zinc-400">
              {r}
              {i < result.records!.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Domains Page ─────────────────────────────────────────────────────────────

export function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [checkingDns, setCheckingDns] = useState<string | null>(null);
  const [dnsResults, setDnsResults] = useState<
    Record<string, DnsCheckResult>
  >({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchDomains = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ domains: Domain[] }>("/domains");
      setDomains(data.domains);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load domains"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDomains();
  }, [fetchDomains]);

  const handleDomainCreated = () => {
    setView("list");
    fetchDomains();
  };

  const handleDnsCheck = async (domainId: string) => {
    setCheckingDns(domainId);
    try {
      const data = await api<{ dns: DnsCheckResult }>(
        `/domains/${domainId}/dns-check`
      );
      setDnsResults((prev) => ({ ...prev, [domainId]: data.dns }));
    } catch (err) {
      setDnsResults((prev) => ({
        ...prev,
        [domainId]: {
          resolved: false,
          message:
            err instanceof ApiError ? err.message : "DNS check failed",
        },
      }));
    } finally {
      setCheckingDns(null);
    }
  };

  const handleDelete = async (domainId: string) => {
    setDeletingId(domainId);
    setError(null);
    try {
      await api(`/domains/${domainId}`, { method: "DELETE" });
      setConfirmDeleteId(null);
      await fetchDomains();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete domain"
      );
    } finally {
      setDeletingId(null);
    }
  };

  // ─── Create view ─────────────────────────────────────────────────────

  if (view === "create") {
    return (
      <AddDomainForm
        onCreated={handleDomainCreated}
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
          <h2 className="text-lg font-semibold text-white">Domains</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage custom domains for your apps
          </p>
        </div>
        <Button variant="primary" onClick={() => setView("create")}>
          Add Domain
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
          <div className="text-sm text-zinc-500">Loading domains...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && domains.length === 0 && (
        <EmptyState
          title="No custom domains"
          description="Add a custom domain to your app. PanelKit will handle SSL certificates automatically."
          action={{
            label: "Add Domain",
            onClick: () => setView("create"),
          }}
        />
      )}

      {/* Domain list */}
      {!loading && domains.length > 0 && (
        <div className="space-y-3">
          {domains.map((d) => (
            <div
              key={d.id}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <h3 className="text-sm font-semibold text-white truncate font-mono-code">
                    {d.domain}
                  </h3>
                  <StatusBadge status={d.status} />
                  {d.sslStatus && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        d.sslStatus === "active"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : d.sslStatus === "pending"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect
                          x="3"
                          y="11"
                          width="18"
                          height="11"
                          rx="2"
                          ry="2"
                        />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      SSL {d.sslStatus}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDnsCheck(d.id)}
                    loading={checkingDns === d.id}
                  >
                    DNS Check
                  </Button>
                  {confirmDeleteId === d.id ? (
                    <>
                      <span className="text-xs text-zinc-500">Sure?</span>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(d.id)}
                        loading={deletingId === d.id}
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
                    </>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setConfirmDeleteId(d.id)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-zinc-500">
                {d.appName && (
                  <span>
                    App:{" "}
                    <span className="text-zinc-400">{d.appName}</span>
                  </span>
                )}
                {d.appId && !d.appName && (
                  <span>
                    App ID:{" "}
                    <span className="text-zinc-400 font-mono-code">
                      {d.appId}
                    </span>
                  </span>
                )}
                <span>Created {formatDate(d.createdAt)}</span>
              </div>

              {dnsResults[d.id] && (
                <DnsCheckDisplay result={dnsResults[d.id]} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
