import { useEffect, useState, useRef, useCallback } from "react";
import { api } from "../api/client";
import { MetricCard } from "../components/ui/MetricCard";
import { Button } from "../components/ui/Button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerStats {
  cpu: number;
  memory: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number };
  network: { rx: number; tx: number };
  uptime: number;
}

interface HistoryPoint {
  timestamp: string;
  cpu?: number;
  memory_percent?: number;
  disk_percent?: number;
  network_rx?: number;
  network_tx?: number;
  avg_cpu?: number;
  avg_memory_percent?: number;
  avg_disk_percent?: number;
  avg_network_rx?: number;
  avg_network_tx?: number;
}

type TimeRange = "1h" | "24h" | "7d" | "30d";

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_STATS: ServerStats = {
  cpu: 24,
  memory: { used: 6.2, total: 16, percent: 39 },
  disk: { used: 87, total: 256, percent: 34 },
  network: { rx: 12.4, tx: 8.7 },
  uptime: 864000,
};

function generateMockHistory(count: number): HistoryPoint[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(now - (count - i) * 60000).toISOString(),
    cpu: 15 + Math.random() * 40,
    memory_percent: 30 + Math.random() * 25,
    disk_percent: 30 + Math.random() * 10,
    network_rx: 5 + Math.random() * 20,
    network_tx: 3 + Math.random() * 15,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  return `${gb.toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getTimeRangeParams(range: TimeRange): { from: string; bucketSeconds: number; limit: number } {
  const now = Date.now();
  switch (range) {
    case "1h":
      return { from: new Date(now - 3600000).toISOString(), bucketSeconds: 60, limit: 60 };
    case "24h":
      return { from: new Date(now - 86400000).toISOString(), bucketSeconds: 900, limit: 96 };
    case "7d":
      return { from: new Date(now - 604800000).toISOString(), bucketSeconds: 3600, limit: 168 };
    case "30d":
      return { from: new Date(now - 2592000000).toISOString(), bucketSeconds: 14400, limit: 180 };
  }
}

function extractValue(point: HistoryPoint, metric: string): number {
  // Handle both raw and aggregated metric keys
  const key = metric as keyof HistoryPoint;
  const aggKey = `avg_${metric}` as keyof HistoryPoint;
  const val = point[aggKey] ?? point[key];
  return typeof val === "number" ? val : 0;
}

// ─── Chart Component ─────────────────────────────────────────────────────────

function HistoryChart({
  data,
  metric,
  color,
  label,
  formatValue,
}: {
  data: HistoryPoint[];
  metric: string;
  color: string;
  label: string;
  formatValue?: (v: number) => string;
}) {
  const values = data.map((p) => extractValue(p, metric));
  const max = Math.max(...values, 1);
  const fmt = formatValue || ((v: number) => `${v.toFixed(1)}`);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-zinc-300">{label}</span>
        {values.length > 0 && (
          <span className="text-xs font-mono-code text-zinc-500">
            Current: {fmt(values[values.length - 1])}
          </span>
        )}
      </div>
      <div className="flex items-end gap-[2px] h-32">
        {values.map((v, i) => (
          <div
            key={i}
            className={`flex-1 rounded-sm min-w-[2px] ${color} transition-all duration-200`}
            style={{ height: `${Math.max((v / max) * 100, 3)}%` }}
            title={`${fmt(v)} at ${new Date(data[i].timestamp).toLocaleTimeString()}`}
          />
        ))}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-zinc-600 font-mono-code">
        <span>{data.length > 0 ? new Date(data[0].timestamp).toLocaleTimeString() : ""}</span>
        <span>{data.length > 0 ? new Date(data[data.length - 1].timestamp).toLocaleTimeString() : ""}</span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function MonitoringPage() {
  const [stats, setStats] = useState<ServerStats>(MOCK_STATS);
  const [history, setHistory] = useState<HistoryPoint[]>(generateMockHistory(60));
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api<{ stats: ServerStats }>("/stats/server");
      setStats(data.stats);
    } catch {
      // keep current data
    }
  }, []);

  const fetchHistory = useCallback(async (range: TimeRange) => {
    setLoading(true);
    try {
      const params = getTimeRangeParams(range);
      const qs = `?from=${encodeURIComponent(params.from)}&bucketSeconds=${params.bucketSeconds}&limit=${params.limit}`;
      const data = await api<{ metrics: HistoryPoint[] }>(`/stats/server/history${qs}`);
      if (data.metrics && data.metrics.length > 0) {
        setHistory(data.metrics);
      } else {
        setHistory(generateMockHistory(params.limit));
      }
    } catch {
      setHistory(generateMockHistory(getTimeRangeParams(range).limit));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStats();
    fetchHistory(timeRange);
  }, [fetchStats, fetchHistory, timeRange]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchStats();
      }, 5000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, fetchStats]);

  const handleTimeRange = (range: TimeRange) => {
    setTimeRange(range);
  };

  // Build mini bar data from stats for MetricCards
  const cpuBars = [18, 22, 30, 25, 19, 24, stats.cpu, 28, 20, 26, 32, stats.cpu];
  const memBars = [35, 38, 36, 40, 39, stats.memory.percent, 42, 37, 41, 39, 38, stats.memory.percent];
  const diskBars = [30, 31, 32, 32, 33, 33, 33, 34, 34, stats.disk.percent, 34, stats.disk.percent];
  const netBars = [8, 10, 12, 9, 11, 14, stats.network.rx, 10, 13, 11, 9, stats.network.rx];

  const ranges: TimeRange[] = ["1h", "24h", "7d", "30d"];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Server Monitoring</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Uptime: <span className="font-mono-code">{formatUptime(stats.uptime)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`
              inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all
              ${autoRefresh
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-300"
              }
            `}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
            Auto-refresh {autoRefresh ? "ON" : "OFF"}
          </button>
          <Button variant="secondary" size="sm" onClick={() => { fetchStats(); fetchHistory(timeRange); }}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="CPU Usage"
          value={`${stats.cpu}%`}
          subtitle="Avg. across all cores"
          bars={cpuBars}
        />
        <MetricCard
          label="Memory"
          value={`${stats.memory.percent}%`}
          subtitle={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
          bars={memBars}
        />
        <MetricCard
          label="Disk"
          value={`${stats.disk.percent}%`}
          subtitle={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
          bars={diskBars}
        />
        <MetricCard
          label="Network"
          value={`${stats.network.rx} MB/s`}
          subtitle={`TX: ${stats.network.tx} MB/s`}
          bars={netBars}
        />
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
          Historical Metrics
        </h3>
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => handleTimeRange(r)}
              className={`
                px-3 py-1 text-xs font-medium rounded-md transition-all
                ${timeRange === r
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
                }
              `}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Charts */}
      {loading ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-16 flex items-center justify-center">
          <p className="text-sm text-zinc-500">Loading metrics...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <HistoryChart
            data={history}
            metric="cpu"
            color="bg-blue-500/40"
            label="CPU Usage"
            formatValue={(v) => `${v.toFixed(1)}%`}
          />
          <HistoryChart
            data={history}
            metric="memory_percent"
            color="bg-emerald-500/40"
            label="Memory Usage"
            formatValue={(v) => `${v.toFixed(1)}%`}
          />
          <HistoryChart
            data={history}
            metric="disk_percent"
            color="bg-violet-500/40"
            label="Disk Usage"
            formatValue={(v) => `${v.toFixed(1)}%`}
          />
          <HistoryChart
            data={history}
            metric="network_rx"
            color="bg-amber-500/40"
            label="Network RX"
            formatValue={(v) => `${v.toFixed(1)} MB/s`}
          />
        </div>
      )}
    </div>
  );
}
