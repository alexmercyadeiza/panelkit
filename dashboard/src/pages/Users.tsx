import { useEffect, useState, useCallback } from "react";
import { api, ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { StatusBadge } from "../components/ui/StatusBadge";
import { EmptyState } from "../components/ui/EmptyState";

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id: string;
  username: string;
  email?: string;
  role: string;
  status: string;
  createdAt: string;
}

type View = "list" | "invite";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const roleBadgeColors: Record<string, string> = {
  admin: "bg-purple-500/10 text-purple-400",
  developer: "bg-blue-500/10 text-blue-400",
  viewer: "bg-zinc-800 text-zinc-400",
};

// ─── Invite User Form ───────────────────────────────────────────────────────

function InviteUserForm({
  onInvited,
  onCancel,
}: {
  onInvited: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "developer" | "viewer">(
    "developer"
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ inviteToken: string }>("/users/invite", {
        method: "POST",
        body: JSON.stringify({
          username,
          email: email || undefined,
          role,
        }),
      });
      setInviteToken(data.inviteToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to invite user");
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = () => {
    if (inviteToken) {
      navigator.clipboard.writeText(inviteToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Show invite token result
  if (inviteToken) {
    return (
      <div className="max-w-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">User Invited</h2>
        </div>

        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-3 mb-4">
          <p className="text-sm text-emerald-400">
            Invitation created for {username}
          </p>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-zinc-300">
            Invite Token
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-300 font-mono-code break-all select-all">
              {inviteToken}
            </code>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">
            Share this token with the user. They will use it to set their
            password and activate their account.
          </p>
        </div>

        <div className="pt-6">
          <Button variant="primary" onClick={onInvited}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">Invite User</h2>
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
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="johndoe"
            required
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Email{" "}
            <span className="text-zinc-600 font-normal">(optional)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="john@example.com"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Role
          </label>
          <div className="flex items-center gap-2">
            {(["admin", "developer", "viewer"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border transition-all capitalize ${
                  role === r
                    ? "bg-blue-600/20 text-blue-400 border-blue-500/30"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-300"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2">
          <Button type="submit" variant="primary" loading={saving}>
            Send Invite
          </Button>
        </div>
      </form>
    </div>
  );
}

// ─── Users Page ─────────────────────────────────────────────────────────────

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);
  const [roleMenuId, setRoleMenuId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ users: User[] }>("/users");
      setUsers(data.users ?? []);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load users"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (
    userId: string,
    newRole: "admin" | "developer" | "viewer"
  ) => {
    setChangingRoleId(userId);
    setError(null);
    try {
      await api(`/users/${userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole }),
      });
      setRoleMenuId(null);
      await fetchUsers();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to change role"
      );
    } finally {
      setChangingRoleId(null);
    }
  };

  const handleDelete = async (userId: string) => {
    setDeletingId(userId);
    setError(null);
    try {
      await api(`/users/${userId}`, { method: "DELETE" });
      setConfirmDeleteId(null);
      await fetchUsers();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete user"
      );
    } finally {
      setDeletingId(null);
    }
  };

  // ─── Invite view ─────────────────────────────────────────────────────

  if (view === "invite") {
    return (
      <InviteUserForm
        onInvited={() => {
          setView("list");
          fetchUsers();
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
        <div>
          <h2 className="text-lg font-semibold text-white">Users</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage team members and their access
          </p>
        </div>
        <Button variant="primary" onClick={() => setView("invite")}>
          Invite User
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
          <div className="text-sm text-zinc-500">Loading users...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && users.length === 0 && (
        <EmptyState
          title="No users"
          description="Invite team members to collaborate on your server management."
          action={{
            label: "Invite User",
            onClick: () => setView("invite"),
          }}
        />
      )}

      {/* Users table */}
      {!loading && users.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Username
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Email
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Role
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Created
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/60 transition-colors duration-75"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-white">
                      {user.username}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {user.email || (
                        <span className="text-zinc-600">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="relative">
                        <button
                          onClick={() =>
                            setRoleMenuId(
                              roleMenuId === user.id ? null : user.id
                            )
                          }
                          disabled={changingRoleId === user.id}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-opacity ${
                            roleBadgeColors[user.role] ||
                            "bg-zinc-800 text-zinc-400"
                          } ${changingRoleId === user.id ? "opacity-50" : ""}`}
                        >
                          <span className="capitalize">{user.role}</span>
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
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                        {roleMenuId === user.id && (
                          <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg z-10 py-1 min-w-[120px]">
                            {(
                              ["admin", "developer", "viewer"] as const
                            ).map((r) => (
                              <button
                                key={r}
                                onClick={() => handleRoleChange(user.id, r)}
                                className={`w-full text-left px-3 py-1.5 text-xs capitalize transition-colors ${
                                  user.role === r
                                    ? "text-blue-400 bg-blue-500/10"
                                    : "text-zinc-300 hover:bg-zinc-700"
                                }`}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {confirmDeleteId === user.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Sure?</span>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDelete(user.id)}
                            loading={deletingId === user.id}
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
                          onClick={() => setConfirmDeleteId(user.id)}
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
