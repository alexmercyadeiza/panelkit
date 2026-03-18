// ─── Domain Management Service ───────────────────────────────────────────────

import { eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "../db";
import { domains, apps } from "../db/schema";
import { generateId } from "./crypto.service";
import * as caddyService from "./caddy.service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DomainRecord {
  id: string;
  appId: string;
  domain: string;
  status: "pending" | "verified" | "failed";
  sslEnabled: boolean;
  createdAt: string;
}

export interface DnsCheckResult {
  domain: string;
  verified: boolean;
  records: string[];
  expectedValue: string;
}

/**
 * Interface for DNS resolution operations.
 * Allows tests to mock DNS lookups.
 */
export interface DnsResolver {
  resolve(domain: string): Promise<string[]>;
}

// ─── Default DNS Resolver ────────────────────────────────────────────────────

export const defaultDnsResolver: DnsResolver = {
  async resolve(domain: string): Promise<string[]> {
    try {
      const { resolve4 } = await import("dns/promises");
      const addresses = await resolve4(domain);
      return addresses;
    } catch {
      return [];
    }
  },
};

// ─── Service State ──────────────────────────────────────────────────────────

let _resolver: DnsResolver = defaultDnsResolver;

/**
 * Set a custom DNS resolver (used for testing).
 */
export function setDnsResolver(resolver: DnsResolver): void {
  _resolver = resolver;
}

/**
 * Reset to the default DNS resolver.
 */
export function resetDnsResolver(): void {
  _resolver = defaultDnsResolver;
}

// ─── Domain Validation ──────────────────────────────────────────────────────

const DOMAIN_REGEX =
  /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})*\.[a-zA-Z]{2,}$/;

const PUNYCODE_LABEL_REGEX = /^xn--[a-zA-Z0-9-]+$/;

/**
 * Validate a domain name format.
 * Accepts standard domains, subdomains, and IDN/punycode domains.
 * Rejects URLs (http://...), domains with spaces, paths, or ports.
 */
export function isValidDomain(domain: string): boolean {
  if (!domain || typeof domain !== "string") return false;

  // Reject URLs
  if (domain.includes("://")) return false;

  // Reject spaces
  if (/\s/.test(domain)) return false;

  // Reject paths
  if (domain.includes("/")) return false;

  // Reject ports
  if (domain.includes(":")) return false;

  // Reject leading/trailing dots
  if (domain.startsWith(".") || domain.endsWith(".")) return false;

  // Check standard domain format
  if (DOMAIN_REGEX.test(domain)) return true;

  // Check punycode (IDN) labels — each label may be xn--...
  const labels = domain.split(".");
  if (labels.length < 2) return false;

  const tld = labels[labels.length - 1];
  if (!/^[a-zA-Z]{2,}$/.test(tld) && !PUNYCODE_LABEL_REGEX.test(tld))
    return false;

  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    // Standard label or punycode label
    if (
      !/^[a-zA-Z0-9-]+$/.test(label) &&
      !PUNYCODE_LABEL_REGEX.test(label)
    )
      return false;
  }

  return true;
}

// ─── Service Functions ──────────────────────────────────────────────────────

/**
 * Add a custom domain linked to an app.
 */
export async function addDomain(
  appId: string,
  domainName: string,
  db?: AppDatabase
): Promise<DomainRecord> {
  const database = db || getDb();

  // Validate domain format
  if (!isValidDomain(domainName)) {
    throw new DomainError(
      "Invalid domain format. Provide a valid domain name (e.g., example.com), not a URL.",
      400
    );
  }

  // Check that the app exists
  const app = await database.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new DomainError("App not found", 404);
  }

  // Check for duplicate domain
  const existing = await database.query.domains.findFirst({
    where: eq(domains.domain, domainName),
  });

  if (existing) {
    throw new DomainError(
      `Domain "${domainName}" is already registered`,
      409
    );
  }

  const id = generateId();
  const now = new Date().toISOString();

  await database.insert(domains).values({
    id,
    appId,
    domain: domainName,
    status: "pending",
    sslEnabled: true,
    createdAt: now,
  });

  // Register route with Caddy if app has a port
  if (app.port) {
    try {
      await caddyService.addRoute({
        id: `domain-${id}`,
        domain: domainName,
        upstream: `localhost:${app.port}`,
      });
    } catch {
      // Caddy registration failure is non-fatal — domain is still stored
    }
  }

  return {
    id,
    appId,
    domain: domainName,
    status: "pending",
    sslEnabled: true,
    createdAt: now,
  };
}

/**
 * Remove a custom domain.
 */
export async function removeDomain(
  domainId: string,
  db?: AppDatabase
): Promise<void> {
  const database = db || getDb();

  const domain = await database.query.domains.findFirst({
    where: eq(domains.id, domainId),
  });

  if (!domain) {
    throw new DomainError("Domain not found", 404);
  }

  // Unregister route from Caddy
  try {
    await caddyService.removeRoute(`domain-${domainId}`);
  } catch {
    // Caddy unregistration failure is non-fatal
  }

  await database.delete(domains).where(eq(domains.id, domainId));
}

/**
 * List all domains, optionally filtered by appId.
 */
export async function listDomains(
  appId?: string,
  db?: AppDatabase
): Promise<DomainRecord[]> {
  const database = db || getDb();

  let results;
  if (appId) {
    results = await database.query.domains.findMany({
      where: eq(domains.appId, appId),
    });
  } else {
    results = await database.query.domains.findMany();
  }

  return results.map((d) => ({
    id: d.id,
    appId: d.appId,
    domain: d.domain,
    status: d.status as DomainRecord["status"],
    sslEnabled: d.sslEnabled,
    createdAt: d.createdAt,
  }));
}

/**
 * Get a single domain by ID.
 */
export async function getDomain(
  domainId: string,
  db?: AppDatabase
): Promise<DomainRecord | null> {
  const database = db || getDb();

  const domain = await database.query.domains.findFirst({
    where: eq(domains.id, domainId),
  });

  if (!domain) return null;

  return {
    id: domain.id,
    appId: domain.appId,
    domain: domain.domain,
    status: domain.status as DomainRecord["status"],
    sslEnabled: domain.sslEnabled,
    createdAt: domain.createdAt,
  };
}

/**
 * Check DNS for a domain (mock-friendly via DnsResolver).
 * Verifies that the domain resolves and updates status in DB.
 */
export async function checkDns(
  domainId: string,
  expectedIp?: string,
  db?: AppDatabase
): Promise<DnsCheckResult> {
  const database = db || getDb();

  const domain = await database.query.domains.findFirst({
    where: eq(domains.id, domainId),
  });

  if (!domain) {
    throw new DomainError("Domain not found", 404);
  }

  const records = await _resolver.resolve(domain.domain);
  const expected = expectedIp || "YOUR_SERVER_IP";
  const verified = records.length > 0 && (expectedIp ? records.includes(expectedIp) : true);

  // Update domain status
  const newStatus = verified ? "verified" : "failed";
  await database
    .update(domains)
    .set({ status: newStatus })
    .where(eq(domains.id, domainId));

  return {
    domain: domain.domain,
    verified,
    records,
    expectedValue: expected,
  };
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class DomainError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "DomainError";
  }
}
