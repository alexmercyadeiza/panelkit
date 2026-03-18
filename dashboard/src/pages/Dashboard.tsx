interface Props {
  user: {
    id: string;
    username: string;
    email: string | null;
    role: string;
  };
  onLogout: () => void;
}

export function DashboardPage({ user, onLogout }: Props) {
  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Top bar */}
      <header className="border-b border-zinc-800 bg-zinc-900/50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="text-white font-semibold text-lg tracking-tight">
            PanelKit
          </span>
          <div className="flex items-center gap-4">
            <span className="text-zinc-400 text-sm">
              {user.username}
              <span className="ml-2 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 text-xs">
                {user.role}
              </span>
            </span>
            <button
              onClick={onLogout}
              className="text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-white mb-6">Dashboard</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Apps", value: "0", href: "/apps" },
            { label: "Databases", value: "0", href: "/databases" },
            { label: "Domains", value: "0", href: "/domains" },
            { label: "Storage", value: "0 MB", href: "/storage" },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-5"
            >
              <p className="text-zinc-400 text-sm">{card.label}</p>
              <p className="text-2xl font-bold text-white mt-1">
                {card.value}
              </p>
            </div>
          ))}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-4">
            Getting Started
          </h3>
          <div className="space-y-3 text-zinc-400 text-sm">
            <p>
              Your PanelKit server is running. Here's what you can do next:
            </p>
            <ul className="list-disc list-inside space-y-1.5 ml-2">
              <li>Deploy an app from a GitHub repository</li>
              <li>Create a MySQL or PostgreSQL database</li>
              <li>Set up a custom domain with automatic SSL</li>
              <li>Configure file storage buckets</li>
              <li>Set up cron jobs and background processes</li>
              <li>Monitor server resources in real-time</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
