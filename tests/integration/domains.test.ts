import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput } from "../helpers/fixtures";
import { setup } from "../../server/services/auth.service";
import { generateId } from "../../server/services/crypto.service";
import { loadConfig } from "../../server/config";
import type { AppDatabase } from "../../server/db";
import { apps } from "../../server/db/schema";
import {
  addDomain,
  removeDomain,
  listDomains,
  getDomain,
  checkDns,
  isValidDomain,
  setDnsResolver,
  resetDnsResolver,
  DomainError,
} from "../../server/services/domain.service";

let db: AppDatabase;
let appId: string;

beforeEach(async () => {
  db = createTestDb();
  resetTestState();
  // Set Caddy URL to localhost with no server so it fails fast
  loadConfig({
    NODE_ENV: "test",
    MASTER_KEY: "a".repeat(64),
    CADDY_ADMIN_URL: "http://127.0.0.1:19999",
  });
  await setup(db, validSetupInput);

  // Create a test app (no port = skip Caddy call)
  appId = generateId();
  const now = new Date().toISOString();
  await db.insert(apps).values({
    id: appId,
    name: "test-app",
    repoUrl: "https://github.com/test/repo.git",
    branch: "main",
    status: "running",
    createdAt: now,
    updatedAt: now,
  });

  // Mock DNS resolver
  setDnsResolver({
    async resolve(domain) {
      if (domain === "verified.example.com") return ["1.2.3.4"];
      if (domain === "wrong.example.com") return ["9.9.9.9"];
      return [];
    },
  });
});

afterEach(() => {
  resetDnsResolver();
});

describe("Domain Validation — isValidDomain", () => {
  it("accepts valid domains", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("sub.example.com")).toBe(true);
    expect(isValidDomain("deep.sub.example.com")).toBe(true);
  });

  it("rejects URLs", () => {
    expect(isValidDomain("http://example.com")).toBe(false);
    expect(isValidDomain("https://example.com")).toBe(false);
  });

  it("rejects domains with spaces", () => {
    expect(isValidDomain("exam ple.com")).toBe(false);
  });

  it("rejects 'not a domain'", () => {
    expect(isValidDomain("not a domain")).toBe(false);
  });

  it("accepts IDN-like domains", () => {
    // Punycode labels
    expect(isValidDomain("xn--nxasmq6b.example.com")).toBe(true);
  });
});

describe("Domain CRUD", () => {
  it("adds a domain and returns record", async () => {
    const domain = await addDomain(appId, "myapp.example.com", db);

    expect(domain.id).toBeDefined();
    expect(domain.domain).toBe("myapp.example.com");
    expect(domain.appId).toBe(appId);
    expect(domain.status).toBe("pending");
  });

  it("rejects duplicate domain", async () => {
    await addDomain(appId, "unique.example.com", db);

    try {
      await addDomain(appId, "unique.example.com", db);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).statusCode).toBe(409);
    }
  });

  it("rejects invalid domain format", async () => {
    try {
      await addDomain(appId, "http://example.com", db);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).statusCode).toBe(400);
    }
  });

  it("removes domain", async () => {
    const domain = await addDomain(appId, "remove.example.com", db);
    await removeDomain(domain.id, db);

    const found = await getDomain(domain.id, db);
    expect(found).toBeNull();
  });

  it("lists domains for app", async () => {
    await addDomain(appId, "a.example.com", db);
    await addDomain(appId, "b.example.com", db);

    const domains = await listDomains(appId, db);
    expect(domains).toHaveLength(2);
  });

  it("lists all domains without appId filter", async () => {
    await addDomain(appId, "all.example.com", db);

    const domains = await listDomains(undefined, db);
    expect(domains.length).toBeGreaterThanOrEqual(1);
  });
});

describe("DNS Verification", () => {
  it("verified domain gets verified status", async () => {
    const domain = await addDomain(appId, "verified.example.com", db);

    const result = await checkDns(domain.id, "1.2.3.4", db);
    expect(result.verified).toBe(true);
  });

  it("wrong DNS returns not verified", async () => {
    const domain = await addDomain(appId, "wrong.example.com", db);

    const result = await checkDns(domain.id, "1.2.3.4", db);
    expect(result.verified).toBe(false);
  });

  it("domain with no DNS records returns not verified", async () => {
    const domain = await addDomain(appId, "nodns.example.com", db);

    const result = await checkDns(domain.id, "1.2.3.4", db);
    expect(result.verified).toBe(false);
  });
});
