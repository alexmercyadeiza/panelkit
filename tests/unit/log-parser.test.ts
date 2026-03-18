import { describe, it, expect } from "bun:test";
import {
  parseLogLine,
  parseLogLines,
  aggregateByDomain,
  aggregateAll,
} from "../../server/lib/log-parser";

describe("Log Parser — parseLogLine", () => {
  it("parses a valid structured JSON log line", () => {
    const line = JSON.stringify({
      ts: 1620000000.123,
      request: {
        method: "GET",
        uri: "/api/health",
        host: "myapp.example.com",
        remote_ip: "1.2.3.4",
        headers: { "User-Agent": ["Mozilla/5.0"] },
      },
      status: 200,
      size: 1234,
      duration: 0.001234,
    });

    const entry = parseLogLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.method).toBe("GET");
    expect(entry!.uri).toBe("/api/health");
    expect(entry!.host).toBe("myapp.example.com");
    expect(entry!.clientIp).toBe("1.2.3.4");
    expect(entry!.status).toBe(200);
    expect(entry!.bytes).toBe(1234);
    expect(entry!.duration).toBe(0.001234);
    expect(entry!.userAgent).toBe("Mozilla/5.0");
    expect(entry!.timestamp).toBeDefined();
  });

  it("handles malformed log lines (returns null)", () => {
    expect(parseLogLine("not valid json at all")).toBeNull();
    expect(parseLogLine("")).toBeNull();
    expect(parseLogLine("   ")).toBeNull();
  });

  it("handles missing fields with defaults", () => {
    const line = JSON.stringify({ ts: 1620000000 });
    const entry = parseLogLine(line);

    expect(entry).not.toBeNull();
    expect(entry!.method).toBe("UNKNOWN");
    expect(entry!.uri).toBe("/");
    expect(entry!.status).toBe(0);
    expect(entry!.bytes).toBe(0);
    expect(entry!.duration).toBe(0);
    expect(entry!.host).toBe("unknown");
  });

  it("parses 2xx status codes", () => {
    const line = JSON.stringify({ status: 201, request: {} });
    const entry = parseLogLine(line);
    expect(entry!.status).toBe(201);
  });

  it("parses 3xx status codes", () => {
    const line = JSON.stringify({ status: 301, request: {} });
    expect(parseLogLine(line)!.status).toBe(301);
  });

  it("parses 4xx status codes", () => {
    const line = JSON.stringify({ status: 404, request: {} });
    expect(parseLogLine(line)!.status).toBe(404);
  });

  it("parses 5xx status codes", () => {
    const line = JSON.stringify({ status: 503, request: {} });
    expect(parseLogLine(line)!.status).toBe(503);
  });

  it("handles missing User-Agent", () => {
    const line = JSON.stringify({ request: { method: "GET" } });
    const entry = parseLogLine(line);
    expect(entry!.userAgent).toBe("");
  });
});

describe("Log Parser — parseLogLines", () => {
  it("parses multiple lines, skipping malformed ones", () => {
    const lines = [
      JSON.stringify({ status: 200, request: { host: "a.com" } }),
      "malformed line",
      JSON.stringify({ status: 404, request: { host: "b.com" } }),
      "",
      JSON.stringify({ status: 500, request: { host: "a.com" } }),
    ].join("\n");

    const entries = parseLogLines(lines);
    expect(entries).toHaveLength(3);
  });

  it("returns empty array for empty input", () => {
    expect(parseLogLines("")).toHaveLength(0);
  });
});

describe("Log Parser — aggregateByDomain", () => {
  it("aggregates by domain correctly", () => {
    const entries = [
      { timestamp: "", method: "GET", uri: "/", status: 200, bytes: 100, duration: 0.01, host: "a.com", clientIp: "", userAgent: "" },
      { timestamp: "", method: "GET", uri: "/", status: 200, bytes: 200, duration: 0.02, host: "a.com", clientIp: "", userAgent: "" },
      { timestamp: "", method: "GET", uri: "/", status: 404, bytes: 50, duration: 0.005, host: "b.com", clientIp: "", userAgent: "" },
    ];

    const agg = aggregateByDomain(entries);
    expect(agg).toHaveLength(2);

    const a = agg.find((x) => x.domain === "a.com")!;
    expect(a.totalRequests).toBe(2);
    expect(a.totalBytes).toBe(300);
    expect(a.avgDuration).toBeCloseTo(0.015, 5);
    expect(a.statusCounts["2xx"]).toBe(2);

    const b = agg.find((x) => x.domain === "b.com")!;
    expect(b.totalRequests).toBe(1);
    expect(b.statusCounts["4xx"]).toBe(1);
  });

  it("classifies status codes into buckets", () => {
    const entries = [
      { timestamp: "", method: "", uri: "", status: 200, bytes: 0, duration: 0, host: "x.com", clientIp: "", userAgent: "" },
      { timestamp: "", method: "", uri: "", status: 301, bytes: 0, duration: 0, host: "x.com", clientIp: "", userAgent: "" },
      { timestamp: "", method: "", uri: "", status: 403, bytes: 0, duration: 0, host: "x.com", clientIp: "", userAgent: "" },
      { timestamp: "", method: "", uri: "", status: 500, bytes: 0, duration: 0, host: "x.com", clientIp: "", userAgent: "" },
      { timestamp: "", method: "", uri: "", status: 100, bytes: 0, duration: 0, host: "x.com", clientIp: "", userAgent: "" },
    ];

    const agg = aggregateByDomain(entries);
    const x = agg[0];
    expect(x.statusCounts["2xx"]).toBe(1);
    expect(x.statusCounts["3xx"]).toBe(1);
    expect(x.statusCounts["4xx"]).toBe(1);
    expect(x.statusCounts["5xx"]).toBe(1);
    expect(x.statusCounts.other).toBe(1);
  });
});

describe("Log Parser — aggregateAll", () => {
  it("aggregates across all domains", () => {
    const entries = [
      { timestamp: "", method: "", uri: "", status: 200, bytes: 100, duration: 0.01, host: "a.com", clientIp: "", userAgent: "" },
      { timestamp: "", method: "", uri: "", status: 200, bytes: 200, duration: 0.03, host: "b.com", clientIp: "", userAgent: "" },
    ];

    const agg = aggregateAll(entries);
    expect(agg.totalRequests).toBe(2);
    expect(agg.totalBytes).toBe(300);
    expect(agg.avgDuration).toBeCloseTo(0.02, 5);
    expect(agg.statusCounts["2xx"]).toBe(2);
  });

  it("handles empty entries", () => {
    const agg = aggregateAll([]);
    expect(agg.totalRequests).toBe(0);
    expect(agg.totalBytes).toBe(0);
    expect(agg.avgDuration).toBe(0);
  });
});
