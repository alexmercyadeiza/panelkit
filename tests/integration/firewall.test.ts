import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  addRule,
  deleteRule,
  getStatus,
  listRules,
  parseUfwOutput,
  isValidIp,
  isValidPort,
  setFirewallExecutor,
  resetFirewallExecutor,
  FirewallError,
  type FirewallExecutor,
} from "../../server/services/firewall.service";

function createMockFirewall(): FirewallExecutor & {
  rules: string[];
  active: boolean;
} {
  const rules: string[] = [];
  return {
    rules,
    active: true,
    async status() {
      let output = `Status: ${this.active ? "active" : "inactive"}\n\n`;
      if (this.rules.length > 0) {
        output += "     To                         Action      From\n";
        output += "     --                         ------      ----\n";
        for (let i = 0; i < this.rules.length; i++) {
          output += `[ ${i + 1}] ${this.rules[i]}\n`;
        }
      }
      return output;
    },
    async addRule(args) {
      // args is like ["allow", "80/tcp"] or ["deny", "9090/tcp"]
      const action = args[0]?.toUpperCase() || "ALLOW";
      const port = args[1] || "any";
      this.rules.push(`${port.padEnd(28)} ${action.padEnd(12)}Anywhere`);
      return "Rule added";
    },
    async deleteRule(ruleNumber) {
      if (ruleNumber > 0 && ruleNumber <= this.rules.length) {
        this.rules.splice(ruleNumber - 1, 1);
        return "Rule deleted";
      }
      return "ERROR: Invalid rule number";
    },
  };
}

let mockFw: ReturnType<typeof createMockFirewall>;

beforeEach(() => {
  mockFw = createMockFirewall();
  setFirewallExecutor(mockFw);
});

afterEach(() => {
  resetFirewallExecutor();
});

describe("Firewall — parseUfwOutput", () => {
  it("parses UFW output correctly", () => {
    const output = `Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 80/tcp                     ALLOW IN    Anywhere
[ 3] 443/tcp                    ALLOW IN    Anywhere`;

    const result = parseUfwOutput(output);
    expect(result.active).toBe(true);
    expect(result.rules).toHaveLength(3);
    expect(result.rules[0].number).toBe(1);
  });

  it("parses inactive status", () => {
    const result = parseUfwOutput("Status: inactive\n");
    expect(result.active).toBe(false);
    expect(result.rules).toHaveLength(0);
  });
});

describe("Firewall — Validation", () => {
  it("validates IPv4 addresses", () => {
    expect(isValidIp("192.168.1.1")).toBe(true);
    expect(isValidIp("10.0.0.0/8")).toBe(true);
    expect(isValidIp("not-an-ip")).toBe(false);
  });

  it("validates port numbers", () => {
    expect(isValidPort(80)).toBe(true);
    expect(isValidPort(443)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
  });
});

describe("Firewall — Rules", () => {
  it("add allow rule works", async () => {
    await addRule({ action: "allow", port: 8080 });
    expect(mockFw.rules.length).toBe(1);
  });

  it("add deny rule works", async () => {
    await addRule({ action: "deny", port: 9090 });
    expect(mockFw.rules.length).toBe(1);
  });

  it("delete rule by number", async () => {
    await addRule({ action: "allow", port: 8080 });
    await addRule({ action: "allow", port: 9090 });

    await deleteRule(1);

    const status = await getStatus();
    expect(status.rules).toHaveLength(1);
  });

  it("cannot deny SSH port 22", async () => {
    try {
      await addRule({ action: "deny", port: 22 });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FirewallError);
    }
  });

  it("cannot deny panel port 3000", async () => {
    try {
      await addRule({ action: "deny", port: 3000 });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FirewallError);
    }
  });

  it("can allow SSH port 22", async () => {
    await addRule({ action: "allow", port: 22 });
    expect(mockFw.rules.length).toBe(1);
  });

  it("invalid port range returns error", async () => {
    try {
      await addRule({ action: "allow", port: 70000 });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(FirewallError);
    }
  });
});

describe("Firewall — List", () => {
  it("list rules returns structured data", async () => {
    await addRule({ action: "allow", port: 80 });
    await addRule({ action: "allow", port: 443 });

    const rules = await listRules();
    expect(rules).toHaveLength(2);
  });
});
