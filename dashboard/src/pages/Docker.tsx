import { useState } from "react";
import { StatusBadge } from "../components/ui/StatusBadge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Container {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  created: string;
}

// ─── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_CONTAINERS: Container[] = [
  {
    id: "a1b2c3d4e5f6",
    name: "nginx-proxy",
    image: "nginx:alpine",
    status: "running",
    ports: "0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp",
    created: "2 days ago",
  },
  {
    id: "f6e5d4c3b2a1",
    name: "postgres-db",
    image: "postgres:16",
    status: "running",
    ports: "5432/tcp",
    created: "5 days ago",
  },
  {
    id: "1a2b3c4d5e6f",
    name: "redis-cache",
    image: "redis:7-alpine",
    status: "running",
    ports: "6379/tcp",
    created: "5 days ago",
  },
  {
    id: "6f5e4d3c2b1a",
    name: "app-worker",
    image: "myapp:latest",
    status: "stopped",
    ports: "",
    created: "1 day ago",
  },
];

// ─── Docker Page ────────────────────────────────────────────────────────────

export function DockerPage() {
  const [containers] = useState<Container[]>(MOCK_CONTAINERS);

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Docker</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage Docker containers on your server
          </p>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">
            Total Containers
          </span>
          <p className="text-2xl font-semibold text-white font-mono-code mt-1">
            {containers.length}
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">
            Running
          </span>
          <p className="text-2xl font-semibold text-emerald-400 font-mono-code mt-1">
            {containers.filter((c) => c.status === "running").length}
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">
            Stopped
          </span>
          <p className="text-2xl font-semibold text-red-400 font-mono-code mt-1">
            {containers.filter((c) => c.status === "stopped").length}
          </p>
        </div>
      </div>

      {/* Placeholder notice */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3">
        <p className="text-sm text-blue-400">
          Docker management is showing placeholder data. A dedicated container
          API will be available in a future update.
        </p>
      </div>

      {/* Containers table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Container Name
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Image
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Ports
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {containers.map((container) => (
                <tr
                  key={container.id}
                  className="border-b border-zinc-800/50 last:border-b-0 hover:bg-zinc-800/60 transition-colors duration-75"
                >
                  <td className="px-4 py-3 text-sm font-medium text-white">
                    {container.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-300 font-mono-code">
                    {container.image}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <StatusBadge status={container.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400 font-mono-code">
                    {container.ports || (
                      <span className="text-zinc-600">--</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {container.created}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
