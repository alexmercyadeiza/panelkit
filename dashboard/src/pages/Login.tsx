import { useState, type FormEvent } from "react";

interface Props {
  onLogin: (input: {
    username: string;
    password: string;
    totpCode?: string;
  }) => Promise<{ requireTotp: boolean }>;
}

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [showTotp, setShowTotp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await onLogin({
        username,
        password,
        totpCode: showTotp ? totpCode : undefined,
      });
      if (result.requireTotp) {
        setShowTotp(true);
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
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
          <p className="text-zinc-400 mt-2">Sign in to your server</p>
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
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Your password"
              autoComplete="current-password"
            />
          </div>

          {showTotp && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Two-Factor Code
              </label>
              <input
                type="text"
                value={totpCode}
                onChange={(e) =>
                  setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-2xl tracking-[0.5em] font-mono"
                placeholder="000000"
                maxLength={6}
                autoFocus
                autoComplete="one-time-code"
              />
            </div>
          )}

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
            {loading ? "Signing in..." : showTotp ? "Verify" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
