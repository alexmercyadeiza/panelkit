import { describe, it, expect, beforeAll } from "bun:test";
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  timingSafeEqual,
  encrypt,
  decrypt,
} from "../../server/services/crypto.service";
import { loadConfig } from "../../server/config";

beforeAll(() => {
  loadConfig({
    NODE_ENV: "test",
    MASTER_KEY: "a".repeat(64),
  });
});

describe("Password Hashing (Argon2)", () => {
  it("produces non-deterministic output for same password", async () => {
    const hash1 = await hashPassword("testpassword123");
    const hash2 = await hashPassword("testpassword123");
    expect(hash1).not.toBe(hash2);
  });

  it("verifies correct password", async () => {
    const hash = await hashPassword("correcthorse");
    const result = await verifyPassword(hash, "correcthorse");
    expect(result).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correcthorse");
    const result = await verifyPassword(hash, "wronghorse");
    expect(result).toBe(false);
  });

  it("rejects empty string", async () => {
    const hash = await hashPassword("realpassword");
    const result = await verifyPassword(hash, "");
    expect(result).toBe(false);
  });

  it("handles unicode/emoji passwords", async () => {
    const password = "🔐パスワード🔑";
    const hash = await hashPassword(password);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, "🔐パスワード")).toBe(false);
  });

  it("handles RTL text", async () => {
    const password = "كلمة المرور السرية";
    const hash = await hashPassword(password);
    expect(await verifyPassword(hash, password)).toBe(true);
  });
});

describe("Session Token Generation", () => {
  it("generates 256-bit (64 hex char) tokens", () => {
    const token = generateSessionToken();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
  });

  it("never produces collisions across 10,000 generations", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      tokens.add(generateSessionToken());
    }
    expect(tokens.size).toBe(10_000);
  });
});

describe("Timing-Safe Comparison", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for different length strings", () => {
    expect(timingSafeEqual("short", "longer string")).toBe(false);
  });

  it("rejects partial matches", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("", "a")).toBe(false);
  });
});

describe("AES-256-GCM Encryption", () => {
  it("encrypt then decrypt returns original plaintext", async () => {
    const plaintext = "hello world secret data";
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("different plaintexts produce different ciphertexts", async () => {
    const ct1 = await encrypt("hello");
    const ct2 = await encrypt("world");
    expect(ct1).not.toBe(ct2);
  });

  it("same plaintext produces different ciphertexts (unique IV)", async () => {
    const ct1 = await encrypt("same data");
    const ct2 = await encrypt("same data");
    expect(ct1).not.toBe(ct2);
    // But both decrypt to same value
    expect(await decrypt(ct1)).toBe(await decrypt(ct2));
  });

  it("tampered ciphertext fails decryption", async () => {
    const encrypted = await encrypt("secret");
    const bytes = Buffer.from(encrypted, "base64");
    // Flip a byte in the ciphertext portion (after 12-byte IV)
    bytes[15] ^= 0xff;
    const tampered = bytes.toString("base64");
    await expect(decrypt(tampered)).rejects.toThrow();
  });

  it("empty string encrypts and decrypts correctly", async () => {
    const encrypted = await encrypt("");
    expect(await decrypt(encrypted)).toBe("");
  });

  it("large value (1MB) encrypts and decrypts", async () => {
    const large = "x".repeat(1024 * 1024);
    const encrypted = await encrypt(large);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(large);
  });
});
