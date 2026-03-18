// ─── Docker Page (Removed) ──────────────────────────────────────────────────

export function DockerPage() {
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
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <div className="text-center">
        <h2 className="text-lg font-semibold text-white">Docker Removed</h2>
        <p className="text-sm text-zinc-500 mt-1 max-w-md">
          Docker management has been removed. All apps are now deployed and
          managed using PM2. Visit the{" "}
          <span className="text-zinc-300">Apps</span> or{" "}
          <span className="text-zinc-300">Processes</span> page to manage your
          deployments.
        </p>
      </div>
    </div>
  );
}
