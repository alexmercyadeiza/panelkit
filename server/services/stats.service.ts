// ─── System Stats Collection Service ─────────────────────────────────────────
//
// Parsing functions accept raw string data for testability.
// Collection functions read from /proc and delegate to parsers.
//

import { readFile } from "fs/promises";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CpuStats {
  /** Overall CPU usage percentage (0–100) */
  usagePercent: number;
  /** Per-core usage percentages */
  perCore: number[];
}

export interface MemoryStats {
  /** Total physical memory in MB */
  totalMb: number;
  /** Used memory in MB (total - available) */
  usedMb: number;
  /** Available memory in MB (includes buffers/cached) */
  availableMb: number;
  /** Memory usage as percentage */
  usagePercent: number;
}

export interface DiskStats {
  /** Device name */
  device: string;
  /** Sectors read since boot */
  sectorsRead: number;
  /** Sectors written since boot */
  sectorsWritten: number;
  /** Read operations count */
  readsCompleted: number;
  /** Write operations count */
  writesCompleted: number;
}

export interface NetworkStats {
  /** Interface name (e.g., eth0, lo) */
  interface: string;
  /** Bytes received */
  rxBytes: number;
  /** Bytes transmitted */
  txBytes: number;
  /** Packets received */
  rxPackets: number;
  /** Packets transmitted */
  txPackets: number;
}

export interface ServerStats {
  cpu: CpuStats | null;
  memory: MemoryStats | null;
  disk: DiskStats[];
  network: NetworkStats[];
  timestamp: string;
}

// ─── CPU Parsing ─────────────────────────────────────────────────────────────

/**
 * CPU tick values from a single /proc/stat cpu line.
 */
export interface CpuTicks {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
}

/**
 * Parse /proc/stat content and extract CPU tick values.
 * Returns an object with `total` (aggregate) and `cores` (per-core) tick arrays.
 */
export function parseProcStat(content: string): {
  total: CpuTicks | null;
  cores: CpuTicks[];
} {
  const result: { total: CpuTicks | null; cores: CpuTicks[] } = {
    total: null,
    cores: [],
  };

  if (!content) return result;

  const lines = content.split("\n");

  for (const line of lines) {
    // Match "cpu " (aggregate) or "cpu0", "cpu1", etc.
    const match = line.match(/^cpu(\d*)\s+(.+)/);
    if (!match) continue;

    const isTotal = match[1] === "";
    const values = match[2].trim().split(/\s+/).map(Number);

    if (values.length < 4) continue;

    const ticks: CpuTicks = {
      user: values[0] || 0,
      nice: values[1] || 0,
      system: values[2] || 0,
      idle: values[3] || 0,
      iowait: values[4] || 0,
      irq: values[5] || 0,
      softirq: values[6] || 0,
      steal: values[7] || 0,
    };

    if (isTotal) {
      result.total = ticks;
    } else {
      result.cores.push(ticks);
    }
  }

  return result;
}

/**
 * Calculate CPU usage percentage from two snapshots of tick data.
 * Returns a value between 0 and 100.
 *
 * Formula: usage = 1 - (idle_delta / total_delta)
 */
export function calculateCpuPercent(
  prev: CpuTicks,
  curr: CpuTicks
): number {
  const prevTotal =
    prev.user + prev.nice + prev.system + prev.idle +
    prev.iowait + prev.irq + prev.softirq + prev.steal;
  const currTotal =
    curr.user + curr.nice + curr.system + curr.idle +
    curr.iowait + curr.irq + curr.softirq + curr.steal;

  const totalDelta = currTotal - prevTotal;
  const idleDelta = (curr.idle + curr.iowait) - (prev.idle + prev.iowait);

  if (totalDelta <= 0) return 0;

  const usage = ((totalDelta - idleDelta) / totalDelta) * 100;
  return Math.max(0, Math.min(100, Math.round(usage * 100) / 100));
}

/**
 * Calculate CPU stats from two /proc/stat snapshots.
 */
export function calculateCpuStats(
  prevContent: string,
  currContent: string
): CpuStats | null {
  const prev = parseProcStat(prevContent);
  const curr = parseProcStat(currContent);

  if (!prev.total || !curr.total) return null;

  const usagePercent = calculateCpuPercent(prev.total, curr.total);

  const perCore: number[] = [];
  const coreCount = Math.min(prev.cores.length, curr.cores.length);

  for (let i = 0; i < coreCount; i++) {
    perCore.push(calculateCpuPercent(prev.cores[i], curr.cores[i]));
  }

  return { usagePercent, perCore };
}

// ─── Memory Parsing ──────────────────────────────────────────────────────────

/**
 * Parse /proc/meminfo content and extract memory stats.
 * Handles MemAvailable, and falls back to computing available from
 * MemFree + Buffers + Cached if MemAvailable is not present.
 */
export function parseMemInfo(content: string): MemoryStats | null {
  if (!content) return null;

  const values: Record<string, number> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB?/);
    if (match) {
      values[match[1]] = parseInt(match[2], 10);
    }
  }

  const totalKb = values["MemTotal"];
  if (totalKb === undefined) return null;

  // MemAvailable is the best indicator (includes reclaimable)
  let availableKb = values["MemAvailable"];
  if (availableKb === undefined) {
    // Fallback: Free + Buffers + Cached
    const free = values["MemFree"] || 0;
    const buffers = values["Buffers"] || 0;
    const cached = values["Cached"] || 0;
    availableKb = free + buffers + cached;
  }

  const totalMb = Math.round(totalKb / 1024);
  const availableMb = Math.round(availableKb / 1024);
  const usedMb = totalMb - availableMb;
  const usagePercent =
    totalMb > 0
      ? Math.round(((usedMb) / totalMb) * 10000) / 100
      : 0;

  return {
    totalMb,
    usedMb: Math.max(0, usedMb),
    availableMb,
    usagePercent: Math.max(0, Math.min(100, usagePercent)),
  };
}

// ─── Disk Parsing ────────────────────────────────────────────────────────────

/**
 * Parse /proc/diskstats content and extract per-device disk I/O stats.
 * Format: major minor name rd_ios rd_merges rd_sectors rd_ticks wr_ios wr_merges wr_sectors wr_ticks ...
 */
export function parseDiskStats(content: string): DiskStats[] {
  if (!content) return [];

  const results: DiskStats[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 7) continue;

    const device = parts[2];
    // Skip partition entries (e.g., sda1) — only keep whole devices and virtual devices
    // Also skip ram, loop devices
    if (!device) continue;
    if (/^(ram|loop)\d+$/.test(device)) continue;

    const readsCompleted = parseInt(parts[3], 10) || 0;
    const sectorsRead = parseInt(parts[5], 10) || 0;
    const writesCompleted = parseInt(parts[6], 10) || 0;
    const sectorsWritten = parts.length > 9 ? parseInt(parts[9], 10) || 0 : 0;

    results.push({
      device,
      sectorsRead,
      sectorsWritten,
      readsCompleted,
      writesCompleted,
    });
  }

  return results;
}

// ─── Network Parsing ─────────────────────────────────────────────────────────

/**
 * Parse /proc/net/dev content and extract per-interface network stats.
 * Format header lines then:  iface: rx_bytes rx_packets ... tx_bytes tx_packets ...
 */
export function parseNetDev(content: string): NetworkStats[] {
  if (!content) return [];

  const results: NetworkStats[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const match = line.match(/^\s*(\w[\w.-]*):\s*(.+)/);
    if (!match) continue;

    const iface = match[1];
    const values = match[2].trim().split(/\s+/).map(Number);

    if (values.length < 10) continue;

    results.push({
      interface: iface,
      rxBytes: values[0] || 0,
      rxPackets: values[1] || 0,
      txBytes: values[8] || 0,
      txPackets: values[9] || 0,
    });
  }

  return results;
}

// ─── Collection Functions (require /proc access) ─────────────────────────────

async function readProcFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

// Previous CPU snapshot for delta calculation
let _prevCpuContent: string | null = null;

/**
 * Collect current server stats from /proc filesystem.
 * Safe to call on non-Linux systems — returns null fields gracefully.
 */
export async function collectServerStats(): Promise<ServerStats> {
  const timestamp = new Date().toISOString();

  // CPU
  let cpu: CpuStats | null = null;
  const cpuContent = await readProcFile("/proc/stat");
  if (cpuContent && _prevCpuContent) {
    cpu = calculateCpuStats(_prevCpuContent, cpuContent);
  }
  _prevCpuContent = cpuContent;

  // Memory
  const memContent = await readProcFile("/proc/meminfo");
  const memory = memContent ? parseMemInfo(memContent) : null;

  // Disk
  const diskContent = await readProcFile("/proc/diskstats");
  const disk = diskContent ? parseDiskStats(diskContent) : [];

  // Network
  const netContent = await readProcFile("/proc/net/dev");
  const network = netContent ? parseNetDev(netContent) : [];

  return { cpu, memory, disk, network, timestamp };
}

/**
 * Reset the internal CPU snapshot (useful for testing).
 */
export function resetCpuSnapshot(): void {
  _prevCpuContent = null;
}
