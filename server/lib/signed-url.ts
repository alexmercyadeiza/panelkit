// ─── HMAC URL Signing ─────────────────────────────────────────────────────────

/**
 * Generate and verify signed URLs using HMAC-SHA256.
 * Used for private storage bucket file access.
 */

// ─── Sign a URL ──────────────────────────────────────────────────────────────

/**
 * Generate a signed URL with path, expiry timestamp, and HMAC-SHA256 signature.
 */
export async function generateSignedUrl(
  baseUrl: string,
  path: string,
  secret: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${path}:${expires}`;
  const signature = await hmacSign(payload, secret);

  const url = new URL(path, baseUrl);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);

  return url.toString();
}

// ─── Verify a Signed URL ────────────────────────────────────────────────────

/**
 * Verify a signed URL — checks both signature validity and expiry.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
export function verifySignedUrl(
  path: string,
  expires: string | number,
  signature: string,
  secret: string
): Promise<{ valid: boolean; reason?: string }> {
  return verifySignature(path, expires, signature, secret);
}

async function verifySignature(
  path: string,
  expires: string | number,
  signature: string,
  secret: string
): Promise<{ valid: boolean; reason?: string }> {
  const expiresNum =
    typeof expires === "string" ? parseInt(expires, 10) : expires;

  if (isNaN(expiresNum)) {
    return { valid: false, reason: "Invalid expiry timestamp" };
  }

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (now > expiresNum) {
    return { valid: false, reason: "URL has expired" };
  }

  // Verify signature
  const payload = `${path}:${expiresNum}`;
  const expectedSignature = await hmacSign(payload, secret);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return { valid: false, reason: "Invalid signature" };
  }

  return { valid: true };
}

// ─── HMAC-SHA256 Signing ─────────────────────────────────────────────────────

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return Buffer.from(signature).toString("hex");
}

// ─── Timing-Safe Comparison ──────────────────────────────────────────────────

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}
