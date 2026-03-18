interface Props {
  status: string;
}

const statusConfig: Record<string, { color: string; dotColor: string }> = {
  // Green statuses
  running: { color: "bg-emerald-500/10 text-emerald-400", dotColor: "bg-emerald-400" },
  healthy: { color: "bg-emerald-500/10 text-emerald-400", dotColor: "bg-emerald-400" },
  active: { color: "bg-emerald-500/10 text-emerald-400", dotColor: "bg-emerald-400" },
  online: { color: "bg-emerald-500/10 text-emerald-400", dotColor: "bg-emerald-400" },
  connected: { color: "bg-emerald-500/10 text-emerald-400", dotColor: "bg-emerald-400" },
  success: { color: "bg-emerald-500/10 text-emerald-400", dotColor: "bg-emerald-400" },
  // Yellow statuses
  building: { color: "bg-amber-500/10 text-amber-400", dotColor: "bg-amber-400" },
  pending: { color: "bg-amber-500/10 text-amber-400", dotColor: "bg-amber-400" },
  deploying: { color: "bg-amber-500/10 text-amber-400", dotColor: "bg-amber-400" },
  restarting: { color: "bg-amber-500/10 text-amber-400", dotColor: "bg-amber-400" },
  warning: { color: "bg-amber-500/10 text-amber-400", dotColor: "bg-amber-400" },
  // Red statuses
  failed: { color: "bg-red-500/10 text-red-400", dotColor: "bg-red-400" },
  stopped: { color: "bg-red-500/10 text-red-400", dotColor: "bg-red-400" },
  error: { color: "bg-red-500/10 text-red-400", dotColor: "bg-red-400" },
  offline: { color: "bg-red-500/10 text-red-400", dotColor: "bg-red-400" },
  crashed: { color: "bg-red-500/10 text-red-400", dotColor: "bg-red-400" },
};

const defaultConfig = { color: "bg-zinc-800 text-zinc-400", dotColor: "bg-zinc-500" };

export function StatusBadge({ status }: Props) {
  const config = statusConfig[status.toLowerCase()] || defaultConfig;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`} />
      <span className="capitalize">{status}</span>
    </span>
  );
}
