import { describe, it, expect } from "bun:test";
import {
  parseEnvString,
  envToRecord,
  recordToEnv,
} from "../../server/lib/env-parser";

describe("Env Parser", () => {
  it("parses simple KEY=value", () => {
    const { entries, errors } = parseEnvString("FOO=bar");
    expect(errors).toHaveLength(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ key: "FOO", value: "bar" });
  });

  it("parses quoted values with spaces", () => {
    const { entries } = parseEnvString('KEY="value with spaces"');
    expect(entries[0].value).toBe("value with spaces");
  });

  it("parses multi-line values in double quotes", () => {
    const input = `KEY="line1
line2
line3"`;
    const { entries, errors } = parseEnvString(input);
    expect(errors).toHaveLength(0);
    expect(entries[0].value).toBe("line1\nline2\nline3");
  });

  it("parses SSH private key in value", () => {
    const sshKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890
abcdefghijklmnopqrstuvwxyz
-----END RSA PRIVATE KEY-----`;
    const input = `SSH_KEY="${sshKey}"`;
    const { entries, errors } = parseEnvString(input);
    expect(errors).toHaveLength(0);
    expect(entries[0].value).toBe(sshKey);
  });

  it("parses values containing = signs", () => {
    const input = 'URL="postgres://user:pass@host/db?opt=1"';
    const { entries } = parseEnvString(input);
    expect(entries[0].value).toBe("postgres://user:pass@host/db?opt=1");
  });

  it("handles unquoted values with = signs", () => {
    const input = "DATABASE_URL=postgres://user:pass@host/db";
    const { entries } = parseEnvString(input);
    expect(entries[0].value).toBe("postgres://user:pass@host/db");
  });

  it("handles empty values: KEY=", () => {
    const { entries } = parseEnvString("KEY=");
    expect(entries[0].value).toBe("");
  });

  it('handles empty quoted values: KEY=""', () => {
    const { entries } = parseEnvString('KEY=""');
    expect(entries[0].value).toBe("");
  });

  it("skips comments (# lines)", () => {
    const input = `# This is a comment
FOO=bar
# Another comment`;
    const { entries } = parseEnvString(input);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("FOO");
  });

  it("skips blank lines", () => {
    const input = `FOO=bar

BAZ=qux`;
    const { entries } = parseEnvString(input);
    expect(entries).toHaveLength(2);
  });

  it("handles unicode values", () => {
    const { entries } = parseEnvString("GREETING=こんにちは世界");
    expect(entries[0].value).toBe("こんにちは世界");
  });

  it("handles emoji in values", () => {
    const { entries } = parseEnvString("EMOJI=🚀💻🔥");
    expect(entries[0].value).toBe("🚀💻🔥");
  });

  it("handles keys with underscores and numbers", () => {
    const { entries, errors } = parseEnvString("MY_VAR_2=value");
    expect(errors).toHaveLength(0);
    expect(entries[0].key).toBe("MY_VAR_2");
  });

  it("rejects lines without = sign", () => {
    const { entries, errors } = parseEnvString("NOEQUALS");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("=");
    expect(entries).toHaveLength(0);
  });

  it("rejects key starting with a number", () => {
    const { errors } = parseEnvString("1BAD=value");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("number");
  });

  it("rejects key containing spaces", () => {
    const { errors } = parseEnvString("BAD KEY=value");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("space");
  });

  it("preserves trailing whitespace inside quotes", () => {
    const { entries } = parseEnvString('KEY="value   "');
    expect(entries[0].value).toBe("value   ");
  });

  it("strips trailing whitespace from unquoted values", () => {
    const { entries } = parseEnvString("KEY=value   ");
    expect(entries[0].value).toBe("value");
  });

  it("handles Windows line endings (\\r\\n)", () => {
    const input = "FOO=bar\r\nBAZ=qux\r\n";
    const { entries } = parseEnvString(input);
    expect(entries).toHaveLength(2);
    expect(entries[0].value).toBe("bar");
    expect(entries[1].value).toBe("qux");
  });

  it("handles mixed line endings", () => {
    const input = "A=1\r\nB=2\nC=3\r";
    const { entries } = parseEnvString(input);
    expect(entries).toHaveLength(3);
  });

  it("handles 1000+ variables without performance issues", () => {
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`VAR_${i}=value_${i}`);
    }
    const start = performance.now();
    const { entries, errors } = parseEnvString(lines.join("\n"));
    const elapsed = performance.now() - start;

    expect(errors).toHaveLength(0);
    expect(entries).toHaveLength(1000);
    expect(elapsed).toBeLessThan(1000); // Should parse in under 1s
  });

  it("handles single-quoted values", () => {
    const { entries } = parseEnvString("KEY='value'");
    expect(entries[0].value).toBe("value");
  });

  it("handles escaped quotes in double-quoted values", () => {
    const { entries } = parseEnvString('KEY="say \\"hello\\""');
    expect(entries[0].value).toBe('say "hello"');
  });
});

describe("envToRecord", () => {
  it("converts parsed entries to a record", () => {
    const record = envToRecord("A=1\nB=2\nC=3");
    expect(record).toEqual({ A: "1", B: "2", C: "3" });
  });

  it("later entries override earlier ones", () => {
    const record = envToRecord("A=1\nA=2");
    expect(record.A).toBe("2");
  });
});

describe("recordToEnv", () => {
  it("serializes a record back to env format", () => {
    const env = recordToEnv({ A: "1", B: "hello world" });
    expect(env).toContain("A=1");
    expect(env).toContain('B="hello world"');
  });

  it("quotes multi-line values", () => {
    const env = recordToEnv({ KEY: "line1\nline2" });
    expect(env).toContain('KEY="line1\nline2"');
  });
});
