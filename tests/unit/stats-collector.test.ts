import { describe, it, expect } from "bun:test";
import {
  parseProcStat,
  calculateCpuPercent,
  calculateCpuStats,
  parseMemInfo,
  parseDiskStats,
  parseNetDev,
  type CpuTicks,
} from "../../server/services/stats.service";

// ─── CPU Parsing ────────────────────────────────────────────────────────────

describe("CPU Parsing — parseProcStat", () => {
  const PROC_STAT_FIXTURE = `cpu  10132153 290696 3084719 46828483 16683 0 25195 0 0 0
cpu0 1393280 32966 572056 13343292 6130 0 17875 0 0 0
cpu1 1335297 28671 540752 13315989 3822 0 2357 0 0 0
cpu2 1339456 28413 549696 13369174 3345 0 2436 0 0 0
cpu3 2064120 200646 1422215 6800028 3386 0 2527 0 0 0
intr 262485451 55 9 0 0
ctxt 326054789
btime 1650000000
processes 102543`;

  it("parses /proc/stat correctly", () => {
    const result = parseProcStat(PROC_STAT_FIXTURE);
    expect(result.total).not.toBeNull();
    expect(result.total!.user).toBe(10132153);
    expect(result.total!.nice).toBe(290696);
    expect(result.total!.system).toBe(3084719);
    expect(result.total!.idle).toBe(46828483);
    expect(result.cores).toHaveLength(4);
  });

  it("handles empty content", () => {
    const result = parseProcStat("");
    expect(result.total).toBeNull();
    expect(result.cores).toHaveLength(0);
  });

  it("handles missing optional fields", () => {
    const content = "cpu  1000 0 500 3000\n";
    const result = parseProcStat(content);
    expect(result.total).not.toBeNull();
    expect(result.total!.iowait).toBe(0);
    expect(result.total!.steal).toBe(0);
  });
});

describe("CPU Percentage Calculation", () => {
  it("returns 0% for fully idle", () => {
    const prev: CpuTicks = { user: 0, nice: 0, system: 0, idle: 1000, iowait: 0, irq: 0, softirq: 0, steal: 0 };
    const curr: CpuTicks = { user: 0, nice: 0, system: 0, idle: 2000, iowait: 0, irq: 0, softirq: 0, steal: 0 };
    expect(calculateCpuPercent(prev, curr)).toBe(0);
  });

  it("returns 100% for fully loaded", () => {
    const prev: CpuTicks = { user: 0, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0 };
    const curr: CpuTicks = { user: 1000, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0 };
    expect(calculateCpuPercent(prev, curr)).toBe(100);
  });

  it("returns ~50% for half idle", () => {
    const prev: CpuTicks = { user: 0, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0 };
    const curr: CpuTicks = { user: 500, nice: 0, system: 0, idle: 500, iowait: 0, irq: 0, softirq: 0, steal: 0 };
    expect(calculateCpuPercent(prev, curr)).toBe(50);
  });

  it("handles multi-core correctly", () => {
    const prev = `cpu  1000 0 500 3000 100 0 0 0
cpu0 500 0 250 1500 50 0 0 0
cpu1 500 0 250 1500 50 0 0 0`;
    const curr = `cpu  2000 0 1000 4000 100 0 0 0
cpu0 1000 0 500 2000 50 0 0 0
cpu1 1000 0 500 2000 50 0 0 0`;

    const stats = calculateCpuStats(prev, curr);
    expect(stats).not.toBeNull();
    expect(stats!.usagePercent).toBeGreaterThan(0);
    expect(stats!.perCore).toHaveLength(2);
    // Each core had same load, so per-core values should be equal
    expect(stats!.perCore[0]).toBe(stats!.perCore[1]);
  });

  it("handles zero delta gracefully", () => {
    const prev: CpuTicks = { user: 100, nice: 0, system: 50, idle: 200, iowait: 0, irq: 0, softirq: 0, steal: 0 };
    // Same as prev = no change
    expect(calculateCpuPercent(prev, prev)).toBe(0);
  });
});

// ─── Memory Parsing ──────────────────────────────────────────────────────────

describe("Memory Parsing — parseMemInfo", () => {
  const MEMINFO_FIXTURE = `MemTotal:       16384000 kB
MemFree:         2048000 kB
MemAvailable:    8192000 kB
Buffers:          512000 kB
Cached:          4096000 kB
SwapCached:            0 kB
Active:          6000000 kB
Inactive:        4000000 kB`;

  it("parses /proc/meminfo correctly", () => {
    const stats = parseMemInfo(MEMINFO_FIXTURE);
    expect(stats).not.toBeNull();
    expect(stats!.totalMb).toBe(16000); // 16384000 / 1024
    expect(stats!.availableMb).toBe(8000); // 8192000 / 1024
    expect(stats!.usedMb).toBe(8000); // 16000 - 8000
    expect(stats!.usagePercent).toBe(50);
  });

  it("falls back to MemFree + Buffers + Cached when MemAvailable is absent", () => {
    const content = `MemTotal:       16384000 kB
MemFree:         2048000 kB
Buffers:          512000 kB
Cached:          4096000 kB`;

    const stats = parseMemInfo(content);
    expect(stats).not.toBeNull();
    // Available = Free + Buffers + Cached = 2048000 + 512000 + 4096000 = 6656000 kB = 6500 MB
    expect(stats!.availableMb).toBe(6500);
    expect(stats!.usedMb).toBe(9500); // 16000 - 6500
  });

  it("handles empty content", () => {
    expect(parseMemInfo("")).toBeNull();
  });

  it("handles missing MemTotal", () => {
    const content = "MemFree: 1000 kB\n";
    expect(parseMemInfo(content)).toBeNull();
  });

  it("handles buffers/cached counted correctly", () => {
    // If only MemFree is present, Buffers and Cached default to 0
    const content = `MemTotal:       8192000 kB
MemFree:         4096000 kB`;

    const stats = parseMemInfo(content);
    expect(stats).not.toBeNull();
    // Available = Free + 0 + 0 = 4096000 kB = 4000 MB
    expect(stats!.availableMb).toBe(4000);
    expect(stats!.usedMb).toBe(4000);
    expect(stats!.usagePercent).toBe(50);
  });
});

// ─── Disk Parsing ────────────────────────────────────────────────────────────

describe("Disk Parsing — parseDiskStats", () => {
  const DISKSTATS_FIXTURE = `   8       0 sda 123456 0 2468912 12345 67890 0 1357802 6789 0 15000 19134
   8       1 sda1 100000 0 2000000 10000 50000 0 1000000 5000 0 12000 15000
 259       0 nvme0n1 500000 0 10000000 50000 300000 0 6000000 30000 0 60000 80000
   7       0 loop0 100 0 200 10 0 0 0 0 0 0 0`;

  it("parses /proc/diskstats correctly", () => {
    const stats = parseDiskStats(DISKSTATS_FIXTURE);
    expect(stats.length).toBeGreaterThan(0);

    // Should exclude loop devices
    const loopDevices = stats.filter((d) => d.device.startsWith("loop"));
    expect(loopDevices).toHaveLength(0);

    const sda = stats.find((d) => d.device === "sda");
    expect(sda).toBeDefined();
    expect(sda!.readsCompleted).toBe(123456);
    expect(sda!.sectorsRead).toBe(2468912);
  });

  it("handles empty content", () => {
    expect(parseDiskStats("")).toHaveLength(0);
  });

  it("handles malformed lines", () => {
    expect(parseDiskStats("garbage data\nmore garbage")).toHaveLength(0);
  });
});

// ─── Network Parsing ─────────────────────────────────────────────────────────

describe("Network Parsing — parseNetDev", () => {
  const NETDEV_FIXTURE = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 12345678   100000    0    0    0     0          0         0 12345678   100000    0    0    0     0       0          0
  eth0: 98765432  1000000    0    0    0     0          0         0 54321098   500000    0    0    0     0       0          0`;

  it("parses /proc/net/dev correctly", () => {
    const stats = parseNetDev(NETDEV_FIXTURE);
    expect(stats).toHaveLength(2);

    const lo = stats.find((s) => s.interface === "lo");
    expect(lo).toBeDefined();
    expect(lo!.rxBytes).toBe(12345678);
    expect(lo!.txBytes).toBe(12345678);

    const eth0 = stats.find((s) => s.interface === "eth0");
    expect(eth0).toBeDefined();
    expect(eth0!.rxBytes).toBe(98765432);
    expect(eth0!.txBytes).toBe(54321098);
    expect(eth0!.rxPackets).toBe(1000000);
    expect(eth0!.txPackets).toBe(500000);
  });

  it("handles empty content", () => {
    expect(parseNetDev("")).toHaveLength(0);
  });

  it("skips header lines", () => {
    const stats = parseNetDev(NETDEV_FIXTURE);
    // Should only have lo and eth0, not the header lines
    expect(stats.every((s) => s.interface !== "Inter-" && s.interface !== "face")).toBe(true);
  });
});
