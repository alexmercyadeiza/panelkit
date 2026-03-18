import { useState, type FormEvent } from "react";

interface Props {
  onComplete: (input: {
    username: string;
    email: string;
    password: string;
  }) => Promise<void>;
}

export function SetupPage({ onComplete }: Props) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!username.trim()) {
      setError("Username is required");
      return;
    }

    if (!email.trim()) {
      setError("Email is required");
      return;
    }

    if (password.length < 12) {
      setError("Password must be at least 12 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await onComplete({ username: username.trim(), email: email.trim(), password });
    } catch (err: any) {
      setError(err.message || "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            PanelKit
          </h1>
          <p className="text-zinc-400 mt-2">
            Create your admin account to get started
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="admin"
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Min 12 characters"
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Repeat your password"
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {loading ? "Creating account..." : "Create Admin Account"}
          </button>
        </form>

        <p className="text-center text-zinc-600 text-xs mt-6">
          This can only be done once. You'll use these credentials to log in.
        </p>
      </div>
    </div>
  );
}
