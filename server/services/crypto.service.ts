import { hash, verify } from "@node-rs/argon2";
import { getConfig } from "../config";

// ─── Password Hashing (Argon2id) ────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return await hash(password, {
    memoryCost: 65536, // 64MB
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(hash, password);
  } catch {
    return false;
  }
}

// ─── Session Token Generation ────────────────────────────────────────────────

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256 bits
  return Buffer.from(bytes).toString("hex");
}

export function generateId(): string {
  return crypto.randomUUID();
}

// ─── Timing-Safe Comparison ──────────────────────────────────────────────────

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

// ─── AES-256-GCM Encryption ─────────────────────────────────────────────────

function getMasterKey(): Uint8Array {
  const config = getConfig();
  const keyHex =
    config.MASTER_KEY || "0".repeat(64); // fallback for dev only
  return new Uint8Array(Buffer.from(keyHex, "hex"));
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    getMasterKey(),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  // Format: base64(iv + ciphertext)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return Buffer.from(combined).toString("base64");
}

export async function decrypt(encrypted: string): Promise<string> {
  const combined = new Uint8Array(Buffer.from(encrypted, "base64"));

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const key = await crypto.subtle.importKey(
    "raw",
    getMasterKey(),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

// ─── Webhook Secret ──────────────────────────────────────────────────────────

export function generateWebhookSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "hex"
  );
}
