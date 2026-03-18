import { describe, it, expect, beforeAll } from "bun:test";
import {
  encrypt,
  decrypt,
} from "../../server/services/crypto.service";
import { loadConfig } from "../../server/config";

beforeAll(() => {
  loadConfig({ NODE_ENV: "test", MASTER_KEY: "a".repeat(64) });
});

describe("AES-256-GCM Encryption (full Phase 6 tests)", () => {
  it("encrypt then decrypt returns original plaintext", async () => {
    const plaintext = "super secret database password!@#$%";
    const encrypted = await encrypt(plaintext);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("different plaintexts produce different ciphertexts", async () => {
    const ct1 = await encrypt("first secret");
    const ct2 = await encrypt("second secret");
    expect(ct1).not.toBe(ct2);
  });

  it("same plaintext encrypted twice produces different ciphertexts (unique IV)", async () => {
    const ct1 = await encrypt("same text");
    const ct2 = await encrypt("same text");
    expect(ct1).not.toBe(ct2);
  });

  it("tampered ciphertext fails decryption with auth error", async () => {
    const encrypted = await encrypt("secret data");
    const bytes = Buffer.from(encrypted, "base64");
    bytes[20] ^= 0xff; // Flip byte in ciphertext
    const tampered = bytes.toString("base64");
    await expect(decrypt(tampered)).rejects.toThrow();
  });

  it("tampered IV fails decryption", async () => {
    const encrypted = await encrypt("secret data");
    const bytes = Buffer.from(encrypted, "base64");
    bytes[0] ^= 0xff; // Flip byte in IV
    const tampered = bytes.toString("base64");
    await expect(decrypt(tampered)).rejects.toThrow();
  });

  it("empty string encrypts and decrypts correctly", async () => {
    const encrypted = await encrypt("");
    expect(await decrypt(encrypted)).toBe("");
  });

  it("large value (1MB) encrypts and decrypts correctly", async () => {
    const large = "x".repeat(1024 * 1024);
    const encrypted = await encrypt(large);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(large);
  });

  it("wrong key fails decryption", async () => {
    const original = loadConfig({ NODE_ENV: "test", MASTER_KEY: "a".repeat(64) });
    const encrypted = await encrypt("secret");

    // Switch to different key
    loadConfig({ NODE_ENV: "test", MASTER_KEY: "b".repeat(64) });

    await expect(decrypt(encrypted)).rejects.toThrow();

    // Restore original key
    loadConfig({ NODE_ENV: "test", MASTER_KEY: "a".repeat(64) });
  });
});
