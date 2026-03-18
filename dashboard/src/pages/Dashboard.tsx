import { useEffect, useState } from "react";
import { api } from "../api/client";
import { MetricCard } from "../components/ui/MetricCard";

interface Props {
  user: {
    username: string;
    role: string;
  };
}

interface ServerStats {
  cpu: number;
  memory: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  network: { rx: number; tx: number };
  uptime: number;
}

interface Deployment {
  id: string;
  app: string;
  status: string;
  timestamp: string;
}

const MOCK_STATS: ServerStats = {
  cpu: 24,
  memory: { used: 6.2, total: 16, percent: 39 },
  disk: { used: 87, total: 256, percent: 34 },
  network: { rx: 12.4, tx: 8.7 },
  uptime: 864000,
};

function formatBytes(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  return `${gb.toFixed(1)} GB`;
}

function MiniBarChart({ bars, color }: { bars: number[]; color: string }) {
  const max = Math.max(...bars, 1);
  return (
    <div className="flex items-end gap-[3px] h-10">
      {bars.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm min-w-[3px] ${color}`}
          style={{ height: `${Math.max((v / max) * 100, 6)}%` }}
        />
      ))}
    </div>
  );
}

function PerformanceCard({
  label,
  percent,
  change,
  bars,
  color,
}: {
  label: string;
  percent: number;
  change: string;
  bars: number[];
  color: string;
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <span className="text-sm font-medium text-zinc-300">{label}</span>
        <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md font-mono-code">
          {change}
        </span>
      </div>
      <div className="text-3xl font-semibold text-white font-mono-code">
        {percent}%
      </div>
      <MiniBarChart bars={bars} color={color} />
    </div>
  );
}

export function DashboardPage({ user }: Props) {
  const [stats, setStats] = useState<ServerStats>(MOCK_STATS);
  const [appCount, setAppCount] = useState(0);
  const [dbCount, setDbCount] = useState(0);
  const [domainCount, setDomainCount] = useState(0);
  const [deployments] = useState<Deployment[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function fetchData() {
      // Fetch server stats
      try {
        const data = await api<ServerStats>("/stats/server");
        setStats(data);
      } catch {
        // keep mock data
      }

      // Fetch app count
      try {
        const data = await api<{ apps: unknown[] }>("/apps");
        setAppCount(data.apps?.length ?? 0);
      } catch {
        setAppCount(0);
      }

      // Fetch database count
      try {
        const data = await api<{ databases: unknown[] }>("/databases");
        setDbCount(data.databases?.length ?? 0);
      } catch {
        setDbCount(0);
      }

      // Fetch domain count
      try {
        const data = await api<{ domains: unknown[] }>("/domains");
        setDomainCount(data.domains?.length ?? 0);
      } catch {
        setDomainCount(0);
      }

      setLoaded(true);
    }

    fetchData();
  }, []);

  // Generate bar data from stats for performance cards
  const cpuBars = [18, 22, 30, 25, 19, 24, stats.cpu, 28, 20, 26, 32, stats.cpu];
  const memBars = [35, 38, 36, 40, 39, stats.memory.percent, 42, 37, 41, 39, 38, stats.memory.percent];
  const diskBars = [30, 31, 32, 32, 33, 33, 33, 34, 34, stats.disk.percent, 34, stats.disk.percent];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-xl font-semibold text-white">
          Welcome back, {user.username}
        </h2>
        <p className="text-sm text-zinc-500 mt-1">
          Here's an overview of your server.
        </p>
      </div>

      {/* Server metrics row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="CPU Usage"
          value={`${stats.cpu}%`}
          subtitle="Avg. across all cores"
          trend={{ value: stats.cpu > 50 ? -5 : 3, label: "vs last hr" }}
          bars={cpuBars}
        />
        <MetricCard
          label="Memory"
          value={`${stats.memory.percent}%`}
          subtitle={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
          trend={{ value: 2, label: "vs last hr" }}
          bars={memBars}
        />
        <MetricCard
          label="Disk"
          value={`${stats.disk.percent}%`}
          subtitle={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
          trend={{ value: 1, label: "this week" }}
          bars={diskBars}
        />
        <MetricCard
          label="Network"
          value={`${stats.network.rx} MB/s`}
          subtitle={`TX: ${stats.network.tx} MB/s`}
          trend={{ value: 12, label: "vs last hr" }}
          bars={[8, 10, 12, 9, 11, 14, stats.network.rx, 10, 13, 11, 9, stats.network.rx]}
        />
      </div>

      {/* Resource counts row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Apps"
          value={loaded ? appCount : "--"}
          subtitle="Deployed applications"
        />
        <MetricCard
          label="Databases"
          value={loaded ? dbCount : "--"}
          subtitle="Active databases"
        />
        <MetricCard
          label="Domains"
          value={loaded ? domainCount : "--"}
          subtitle="Configured domains"
        />
        <MetricCard
          label="Storage Used"
          value={formatBytes(stats.disk.used)}
          subtitle={`of ${formatBytes(stats.disk.total)} total`}
        />
      </div>

      {/* Server Performance */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">
          Server Performance
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PerformanceCard
            label="Server Performance Metrics"
            percent={stats.cpu}
            change="+45%"
            bars={cpuBars}
            color="bg-blue-500/40"
          />
          <PerformanceCard
            label="Server Utilization Trends"
            percent={stats.memory.percent}
            change="+30%"
            bars={memBars}
            color="bg-emerald-500/40"
          />
          <PerformanceCard
            label="Server Efficiency Analysis"
            percent={100 - stats.disk.percent}
            change="+55%"
            bars={diskBars}
            color="bg-violet-500/40"
          />
        </div>
      </div>

      {/* Recent Deployments */}
      <div>
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide mb-4">
          Recent Deployments
        </h3>
        {deployments.length > 0 ? (
          <div className="space-y-2">
            {deployments.map((d) => (
              <div
                key={d.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between"
              >
                <div>
                  <span className="text-sm font-medium text-white">
                    {d.app}
                  </span>
                  <span className="text-xs text-zinc-500 ml-3">
                    {d.timestamp}
                  </span>
                </div>
                <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                  {d.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-zinc-600"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <p className="text-sm text-zinc-500">No recent deployments</p>
          </div>
        )}
      </div>
    </div>
  );
}
