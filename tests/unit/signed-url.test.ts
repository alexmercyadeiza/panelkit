import { describe, it, expect } from "bun:test";
import {
  generateSignedUrl,
  verifySignedUrl,
} from "../../server/lib/signed-url";

describe("Signed URL — Generation", () => {
  it("generates URL containing signature and expiry", async () => {
    const url = await generateSignedUrl(
      "https://example.com",
      "/files/test.txt",
      "my-secret",
      3600
    );

    const parsed = new URL(url);
    expect(parsed.searchParams.get("signature")).toBeDefined();
    expect(parsed.searchParams.get("expires")).toBeDefined();
    expect(parsed.pathname).toBe("/files/test.txt");
  });

  it("valid signature verifies correctly", async () => {
    const secret = "test-secret-key";
    const path = "/files/document.pdf";
    const url = await generateSignedUrl("https://example.com", path, secret, 3600);

    const parsed = new URL(url);
    const signature = parsed.searchParams.get("signature")!;
    const expires = parsed.searchParams.get("expires")!;

    const result = await verifySignedUrl(path, expires, signature, secret);
    expect(result.valid).toBe(true);
  });

  it("expired URL rejected even with valid signature", async () => {
    const secret = "test-secret";
    const path = "/files/test.txt";
    // Generate URL that already expired (negative TTL)
    const url = await generateSignedUrl("https://example.com", path, secret, -1);

    const parsed = new URL(url);
    const signature = parsed.searchParams.get("signature")!;
    const expires = parsed.searchParams.get("expires")!;

    const result = await verifySignedUrl(path, expires, signature, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expired");
  });

  it("any byte change in path invalidates signature", async () => {
    const secret = "test-secret";
    const path = "/files/test.txt";
    const url = await generateSignedUrl("https://example.com", path, secret, 3600);

    const parsed = new URL(url);
    const signature = parsed.searchParams.get("signature")!;
    const expires = parsed.searchParams.get("expires")!;

    // Tamper with path
    const result = await verifySignedUrl("/files/test2.txt", expires, signature, secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid signature");
  });

  it("different secrets produce different signatures", async () => {
    const path = "/files/test.txt";
    const url1 = await generateSignedUrl("https://example.com", path, "secret-a", 3600);
    const url2 = await generateSignedUrl("https://example.com", path, "secret-b", 3600);

    const sig1 = new URL(url1).searchParams.get("signature");
    const sig2 = new URL(url2).searchParams.get("signature");
    expect(sig1).not.toBe(sig2);
  });

  it("wrong secret fails verification", async () => {
    const path = "/files/test.txt";
    const url = await generateSignedUrl("https://example.com", path, "correct-secret", 3600);

    const parsed = new URL(url);
    const signature = parsed.searchParams.get("signature")!;
    const expires = parsed.searchParams.get("expires")!;

    const result = await verifySignedUrl(path, expires, signature, "wrong-secret");
    expect(result.valid).toBe(false);
  });

  it("tampered expiry invalidates signature", async () => {
    const secret = "test-secret";
    const path = "/files/test.txt";
    const url = await generateSignedUrl("https://example.com", path, secret, 3600);

    const parsed = new URL(url);
    const signature = parsed.searchParams.get("signature")!;

    // Tamper with expiry (extend it)
    const tamperedExpiry = String(Math.floor(Date.now() / 1000) + 999999);
    const result = await verifySignedUrl(path, tamperedExpiry, signature, secret);
    expect(result.valid).toBe(false);
  });

  it("handles invalid expiry format", async () => {
    const result = await verifySignedUrl("/path", "not-a-number", "sig", "secret");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid expiry");
  });
});
