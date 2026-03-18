import { useAuth } from "./hooks/useAuth";
import { SetupPage } from "./pages/Setup";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";

export function App() {
  const { user, loading, setupComplete, setup, login, logout } = useAuth();

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  // First-time setup — no admin account yet
  if (setupComplete === false) {
    return <SetupPage onComplete={setup} />;
  }

  // Not logged in
  if (!user) {
    return <LoginPage onLogin={login} />;
  }

  // Logged in
  return <DashboardPage user={user} onLogout={logout} />;
}
