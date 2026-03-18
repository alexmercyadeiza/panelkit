// ─── Firewall (UFW) Management Service ───────────────────────────────────────

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FirewallRule {
  number: number;
  to: string;
  action: string;
  from: string;
  comment?: string;
}

export interface FirewallStatus {
  active: boolean;
  rules: FirewallRule[];
}

export interface AddRuleInput {
  port: number | string;
  protocol?: "tcp" | "udp" | "any";
  action: "allow" | "deny";
  from?: string;
  comment?: string;
}

/**
 * Interface for UFW operations.
 * Allows tests to mock all firewall interactions.
 */
export interface FirewallExecutor {
  status(): Promise<string>;
  addRule(args: string[]): Promise<string>;
  deleteRule(ruleNumber: number): Promise<string>;
}

// ─── Default Executor (uses ufw CLI via Bun.spawn) ──────────────────────────

async function ufwCommand(
  args: string[],
  timeout: number = 15000
): Promise<string> {
  const proc = Bun.spawn(["sudo", "ufw", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeout);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new FirewallError(
      `UFW command failed (exit code ${exitCode}): ${stderr.trim()}`,
      500
    );
  }

  return await new Response(proc.stdout).text();
}

export const defaultFirewallExecutor: FirewallExecutor = {
  async status(): Promise<string> {
    return ufwCommand(["status", "numbered"]);
  },

  async addRule(args: string[]): Promise<string> {
    return ufwCommand(args);
  },

  async deleteRule(ruleNumber: number): Promise<string> {
    // --force to avoid interactive confirmation
    return ufwCommand(["--force", "delete", String(ruleNumber)]);
  },
};

// ─── Service State ──────────────────────────────────────────────────────────

let _executor: FirewallExecutor = defaultFirewallExecutor;

/**
 * Set a custom firewall executor (used for testing).
 */
export function setFirewallExecutor(executor: FirewallExecutor): void {
  _executor = executor;
}

/**
 * Reset to the default firewall executor.
 */
export function resetFirewallExecutor(): void {
  _executor = defaultFirewallExecutor;
}

// ─── Protected Ports ────────────────────────────────────────────────────────

const PROTECTED_PORTS = new Set([22, 3000]);

/**
 * Check if a port is protected from being blocked.
 */
function isProtectedPort(port: number | string): boolean {
  const portNum = typeof port === "string" ? parseInt(port, 10) : port;
  if (isNaN(portNum)) return false;
  return PROTECTED_PORTS.has(portNum);
}

// ─── Validation ─────────────────────────────────────────────────────────────

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

const CIDR_V4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\/(?:[12]?\d|3[0-2])$/;

/**
 * Validate an IP address or CIDR notation.
 */
export function isValidIp(ip: string): boolean {
  if (!ip) return false;
  return IPV4_REGEX.test(ip) || CIDR_V4_REGEX.test(ip);
}

/**
 * Validate a port number or range.
 */
export function isValidPort(port: number | string): boolean {
  if (typeof port === "string") {
    // Allow port ranges like "8000:8100"
    if (/^\d+:\d+$/.test(port)) {
      const [start, end] = port.split(":").map(Number);
      return start >= 1 && start <= 65535 && end >= 1 && end <= 65535 && start <= end;
    }
    const num = parseInt(port, 10);
    if (isNaN(num)) return false;
    return num >= 1 && num <= 65535;
  }
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// ─── UFW Output Parsing ─────────────────────────────────────────────────────

/**
 * Parse UFW numbered status output into structured rules.
 *
 * Example UFW output:
 *   Status: active
 *
 *        To                         Action      From
 *        --                         ------      ----
 *   [ 1] 22/tcp                     ALLOW IN    Anywhere
 *   [ 2] 80/tcp                     DENY IN     192.168.1.0/24
 */
export function parseUfwOutput(output: string): FirewallStatus {
  const lines = output.split("\n");
  const active = lines.some((l) => /^Status:\s*active/i.test(l.trim()));

  const rules: FirewallRule[] = [];

  for (const line of lines) {
    const match = line.match(
      /^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)\s+(?:IN\s+)?(.+?)$/i
    );

    if (match) {
      rules.push({
        number: parseInt(match[1], 10),
        to: match[2].trim(),
        action: match[3].trim().toUpperCase(),
        from: match[4].trim(),
      });
    }
  }

  return { active, rules };
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Get firewall status and rules.
 */
export async function getStatus(): Promise<FirewallStatus> {
  const output = await _executor.status();
  return parseUfwOutput(output);
}

/**
 * List firewall rules.
 */
export async function listRules(): Promise<FirewallRule[]> {
  const status = await getStatus();
  return status.rules;
}

/**
 * Add a firewall rule.
 */
export async function addRule(input: AddRuleInput): Promise<void> {
  // Validate port
  if (!isValidPort(input.port)) {
    throw new FirewallError(
      "Invalid port. Must be 1-65535 or a valid range (e.g., 8000:8100).",
      400
    );
  }

  // Self-protection: cannot block SSH (22) or panel port (3000)
  if (input.action === "deny" && isProtectedPort(input.port)) {
    throw new FirewallError(
      `Cannot block port ${input.port} — it is a protected port (SSH or panel access).`,
      403
    );
  }

  // Validate source IP if provided
  if (input.from && input.from !== "any" && !isValidIp(input.from)) {
    throw new FirewallError(
      "Invalid source IP address. Use IPv4 or CIDR notation.",
      400
    );
  }

  const protocol = input.protocol && input.protocol !== "any"
    ? `/${input.protocol}`
    : "";

  const portStr = `${input.port}${protocol}`;

  const args: string[] = [];

  if (input.from && input.from !== "any") {
    // ufw allow/deny from <ip> to any port <port> [proto <proto>]
    args.push(
      input.action,
      "from",
      input.from,
      "to",
      "any",
      "port",
      String(input.port)
    );
    if (input.protocol && input.protocol !== "any") {
      args.push("proto", input.protocol);
    }
  } else {
    // ufw allow/deny <port>[/proto]
    args.push(input.action, portStr);
  }

  if (input.comment) {
    args.push("comment", input.comment);
  }

  await _executor.addRule(args);
}

/**
 * Delete a firewall rule by its number.
 */
export async function deleteRule(ruleNumber: number): Promise<void> {
  if (!Number.isInteger(ruleNumber) || ruleNumber < 1) {
    throw new FirewallError("Invalid rule number", 400);
  }

  // Get current rules to verify the rule exists and check protection
  const status = await getStatus();
  const rule = status.rules.find((r) => r.number === ruleNumber);

  if (!rule) {
    throw new FirewallError(`Rule #${ruleNumber} not found`, 404);
  }

  // Check if deleting this rule would affect a protected port
  // Extract port from the "to" field (e.g., "22/tcp" -> 22)
  const portMatch = rule.to.match(/^(\d+)/);
  if (portMatch) {
    const port = parseInt(portMatch[1], 10);
    if (
      isProtectedPort(port) &&
      rule.action === "ALLOW"
    ) {
      throw new FirewallError(
        `Cannot delete allow rule for protected port ${port} (SSH or panel access).`,
        403
      );
    }
  }

  await _executor.deleteRule(ruleNumber);
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class FirewallError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "FirewallError";
  }
}
