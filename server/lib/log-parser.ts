// ─── Caddy Access Log Parser ─────────────────────────────────────────────────

/**
 * Parsed representation of a single Caddy access log entry.
 * Caddy emits structured JSON logs by default.
 */
export interface ParsedLogEntry {
  /** Timestamp from the log, ISO string or epoch seconds */
  timestamp: string;
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Request URI / path */
  uri: string;
  /** HTTP status code */
  status: number;
  /** Response body size in bytes */
  bytes: number;
  /** Request duration in seconds */
  duration: number;
  /** Requested host / domain */
  host: string;
  /** Client IP address */
  clientIp: string;
  /** User-Agent header */
  userAgent: string;
}

/**
 * Aggregated log stats for a domain/app.
 */
export interface LogAggregation {
  domain: string;
  totalRequests: number;
  totalBytes: number;
  avgDuration: number;
  statusCounts: {
    "2xx": number;
    "3xx": number;
    "4xx": number;
    "5xx": number;
    other: number;
  };
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Parse a single Caddy JSON log line into a structured entry.
 * Returns null for malformed or unparseable lines.
 *
 * Caddy JSON log format (default structured logging):
 * {
 *   "ts": 1620000000.123,
 *   "request": { "method": "GET", "uri": "/path", "host": "example.com", "headers": { "User-Agent": ["..."] }, "remote_ip": "1.2.3.4" },
 *   "status": 200,
 *   "size": 1234,
 *   "duration": 0.001234
 * }
 */
export function parseLogLine(line: string): ParsedLogEntry | null {
  if (!line || !line.trim()) {
    return null;
  }

  try {
    const entry = JSON.parse(line.trim());

    // Extract timestamp — Caddy uses "ts" as epoch seconds (float)
    let timestamp: string;
    if (typeof entry.ts === "number") {
      timestamp = new Date(entry.ts * 1000).toISOString();
    } else if (typeof entry.ts === "string") {
      timestamp = entry.ts;
    } else {
      timestamp = new Date().toISOString();
    }

    // Extract request fields with fallbacks
    const request = entry.request || {};
    const method = typeof request.method === "string" ? request.method : "UNKNOWN";
    const uri = typeof request.uri === "string" ? request.uri : "/";
    const host = typeof request.host === "string" ? request.host : "unknown";
    const clientIp =
      typeof request.remote_ip === "string"
        ? request.remote_ip
        : typeof request.remote_addr === "string"
          ? request.remote_addr.replace(/:\d+$/, "")
          : "0.0.0.0";

    // User-Agent from headers
    let userAgent = "";
    if (request.headers && request.headers["User-Agent"]) {
      const ua = request.headers["User-Agent"];
      userAgent = Array.isArray(ua) ? ua[0] || "" : String(ua);
    }

    // Status code — default to 0 if missing
    const status =
      typeof entry.status === "number"
        ? entry.status
        : typeof entry.resp_headers?.status === "number"
          ? entry.resp_headers.status
          : 0;

    // Response size in bytes
    const bytes =
      typeof entry.size === "number"
        ? entry.size
        : typeof entry.response_size === "number"
          ? entry.response_size
          : 0;

    // Duration in seconds
    const duration =
      typeof entry.duration === "number"
        ? entry.duration
        : typeof entry.latency === "number"
          ? entry.latency
          : 0;

    return {
      timestamp,
      method,
      uri,
      status,
      bytes,
      duration,
      host,
      clientIp,
      userAgent,
    };
  } catch {
    // Malformed JSON — skip silently
    return null;
  }
}

/**
 * Parse multiple log lines. Skips malformed lines without errors.
 */
export function parseLogLines(rawLog: string): ParsedLogEntry[] {
  const lines = rawLog.split("\n");
  const entries: ParsedLogEntry[] = [];

  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (parsed) {
      entries.push(parsed);
    }
  }

  return entries;
}

// ─── Status Code Classification ──────────────────────────────────────────────

function classifyStatus(status: number): keyof LogAggregation["statusCounts"] {
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return "other";
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Aggregate parsed log entries by domain/host.
 * Returns an array of aggregations, one per unique domain.
 */
export function aggregateByDomain(entries: ParsedLogEntry[]): LogAggregation[] {
  const domainMap = new Map<
    string,
    {
      totalRequests: number;
      totalBytes: number;
      totalDuration: number;
      statusCounts: LogAggregation["statusCounts"];
    }
  >();

  for (const entry of entries) {
    const domain = entry.host;
    let agg = domainMap.get(domain);

    if (!agg) {
      agg = {
        totalRequests: 0,
        totalBytes: 0,
        totalDuration: 0,
        statusCounts: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 },
      };
      domainMap.set(domain, agg);
    }

    agg.totalRequests++;
    agg.totalBytes += entry.bytes;
    agg.totalDuration += entry.duration;
    agg.statusCounts[classifyStatus(entry.status)]++;
  }

  const results: LogAggregation[] = [];

  for (const [domain, agg] of domainMap) {
    results.push({
      domain,
      totalRequests: agg.totalRequests,
      totalBytes: agg.totalBytes,
      avgDuration:
        agg.totalRequests > 0 ? agg.totalDuration / agg.totalRequests : 0,
      statusCounts: agg.statusCounts,
    });
  }

  return results;
}

/**
 * Aggregate all entries into a single summary (across all domains).
 */
export function aggregateAll(entries: ParsedLogEntry[]): Omit<LogAggregation, "domain"> {
  const statusCounts: LogAggregation["statusCounts"] = {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
    other: 0,
  };

  let totalBytes = 0;
  let totalDuration = 0;

  for (const entry of entries) {
    totalBytes += entry.bytes;
    totalDuration += entry.duration;
    statusCounts[classifyStatus(entry.status)]++;
  }

  return {
    totalRequests: entries.length,
    totalBytes,
    avgDuration: entries.length > 0 ? totalDuration / entries.length : 0,
    statusCounts,
  };
}
