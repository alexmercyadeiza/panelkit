import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FirewallRule {
  number: number;
  to: string;
  action: string;
  from: string;
  protocol: string;
  comment?: string;
}

type View = "list" | "create";

// ─── Add Rule Form ──────────────────────────────────────────────────────────

function AddRuleForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [action, setAction] = useState<"allow" | "deny">("allow");
  const [port, setPort] = useState("");
  const [protocol, setProtocol] = useState<"tcp" | "udp" | "any">("any");
  const [from, setFrom] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const portValue = /^\d+$/.test(port) ? parseInt(port, 10) : port;
      await api("/firewall/rules", {
        method: "POST",
        body: JSON.stringify({
          action,
          port: portValue,
          protocol,
          from: from || undefined,
          comment: comment || undefined,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add rule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Add Firewall Rule</h2>
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
            Action
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAction("allow")}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                action === "allow"
                  ? "bg-emerald-600/20 text-emerald-400 border-emerald-500/30"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-300"
              }`}
            >
              Allow
            </button>
            <button
              type="button"
              onClick={() => setAction("deny")}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                action === "deny"
                  ? "bg-red-600/20 text-red-400 border-red-500/30"
                  : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-300"
              }`}
            >
              Deny
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Port
            </label>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="80"
              required
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
            />
            <p className="text-xs text-zinc-600 mt-1">
              Port number or range (e.g. 8000:8080)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Protocol
            </label>
            <select
              value={protocol}
              onChange={(e) =>
                setProtocol(e.target.value as "tcp" | "udp" | "any")
              }
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="any">Both (TCP/UDP)</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Source IP{" "}
            <span className="text-zinc-600 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="Anywhere"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 font-mono-code"
          />
          <p className="text-xs text-zinc-600 mt-1">
            Leave blank to allow/deny from anywhere
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Comment{" "}
            <span className="text-zinc-600 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="HTTP traffic"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="pt-2">
          <Button type="submit" variant="primary" loading={saving}>
            Add Rule
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Firewall Page ──────────────────────────────────────────────────────────

export function FirewallPage() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [deletingNumber, setDeletingNumber] = useState<number | null>(null);
  const [confirmDeleteNumber, setConfirmDeleteNumber] = useState<number | null>(
    null
  );

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ active: boolean; rules: FirewallRule[] }>(
        "/firewall/rules"
      );
      setActive(data.active);
      setRules(data.rules ?? []);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load firewall rules"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleDelete = async (ruleNumber: number) => {
    setDeletingNumber(ruleNumber);
    setError(null);
    try {
      await api(`/firewall/rules/${ruleNumber}`, { method: "DELETE" });
      setConfirmDeleteNumber(null);
      await fetchRules();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete rule"
      );
    } finally {
      setDeletingNumber(null);
    }
  };

  // ─── Create view ─────────────────────────────────────────────────────

  if (view === "create") {
    return (
      <AddRuleForm
        onCreated={() => {
          setView("list");
          fetchRules();
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  // ─── List view ────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Firewall</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              Manage UFW firewall rules
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
              active
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                active ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            {active ? "Active" : "Inactive"}
          </span>
        </div>
        <Button variant="primary" onClick={() => setView("create")}>
          Add Rule
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
          <div className="text-sm text-zinc-500">Loading firewall rules...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && rules.length === 0 && (
        <EmptyState
          title="No firewall rules"
          description="Add a firewall rule to control incoming and outgoing traffic on your server."
          action={{
            label: "Add Rule",
            onClick: () => setView("create"),
          }}
        />
      )}

      {/* Rules table */}
      {!loading && rules.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    #
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    To (Port)
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Action
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    From
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Protocol
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr
                    key={rule.number}
                    className="border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/60 transition-colors duration-75"
                  >
                    <td className="px-4 py-3 text-sm text-zinc-400 font-mono-code">
                      {rule.number}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">
                      {rule.to}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          rule.action.toLowerCase() === "allow"
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-red-500/10 text-red-400"
                        }`}
                      >
                        {rule.action.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">
                      {rule.from || "Anywhere"}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400 font-mono-code">
                      {rule.protocol}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {confirmDeleteNumber === rule.number ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Sure?</span>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDelete(rule.number)}
                            loading={deletingNumber === rule.number}
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDeleteNumber(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setConfirmDeleteNumber(rule.number)
                          }
                          className="text-red-400 hover:text-red-300"
                        >
                          Delete
                        </Button>
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
