import { useState } from "react";
import { useAuth } from "./hooks/useAuth";
import { SetupPage } from "./pages/Setup";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { AppsPage } from "./pages/Apps";
import { DatabasesPage } from "./pages/Databases";
import { StoragePage } from "./pages/Storage";
import { DomainsPage } from "./pages/Domains";
import { CronJobsPage } from "./pages/CronJobs";
import { ProcessesPage } from "./pages/Processes";
import { FirewallPage } from "./pages/Firewall";
import { BackupsPage } from "./pages/Backups";
import { UsersPage } from "./pages/Users";
import { SettingsPage } from "./pages/Settings";
import { DockerPage } from "./pages/Docker";
import { TerminalPage } from "./pages/Terminal";
import { Layout } from "./components/layout/Layout";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/apps": "Apps",
  "/databases": "Databases",
  "/domains": "Domains",
  "/storage": "Storage",
  "/cron": "Cron Jobs",
  "/processes": "Processes",
  "/docker": "Docker",
  "/firewall": "Firewall",
  "/backups": "Backups",
  "/terminal": "Terminal",
  "/settings": "Settings",
  "/users": "Users",
};

function PlaceholderPage({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
      <div className="w-14 h-14 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-zinc-500"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 21V9" />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">{name}</h2>
        <p className="text-sm text-zinc-500 mt-1">This page is coming soon.</p>
      </div>
    </div>
  );
}

export function App() {
  const { user, loading, setupComplete, setup, login, logout } = useAuth();
  const [currentPath, setCurrentPath] = useState("/");

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

  // Resolve current page component
  const title = PAGE_TITLES[currentPath] || "Dashboard";
  let page: React.ReactNode;

  switch (currentPath) {
    case "/":
      page = <DashboardPage user={user} />;
      break;
    case "/apps":
      page = <AppsPage />;
      break;
    case "/databases":
      page = <DatabasesPage />;
      break;
    case "/storage":
      page = <StoragePage />;
      break;
    case "/domains":
      page = <DomainsPage />;
      break;
    case "/cron":
      page = <CronJobsPage />;
      break;
    case "/processes":
      page = <ProcessesPage />;
      break;
    case "/firewall":
      page = <FirewallPage />;
      break;
    case "/backups":
      page = <BackupsPage />;
      break;
    case "/users":
      page = <UsersPage />;
      break;
    case "/settings":
      page = <SettingsPage />;
      break;
    case "/docker":
      page = <DockerPage />;
      break;
    case "/terminal":
      page = <TerminalPage />;
      break;
    default:
      page = <PlaceholderPage name="Not Found" />;
      break;
  }

  return (
    <Layout
      currentPath={currentPath}
      onNavigate={setCurrentPath}
      title={title}
      user={user}
      onLogout={logout}
    >
      {page}
    </Layout>
  );
}
