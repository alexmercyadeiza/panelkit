// ─── TOTP Two-Factor Authentication Service ──────────────────────────────────

import { TOTP, Secret } from "otpauth";
import { eq } from "drizzle-orm";
import { getDb, type AppDatabase } from "../db";
import { users } from "../db/schema";
import { timingSafeEqual } from "./crypto.service";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TotpSetup {
  secret: string;
  uri: string;
  recoveryCodes: string[];
}

export interface TotpValidation {
  valid: boolean;
  usedRecoveryCode?: boolean;
}

// ─── Replay Protection (in-memory) ──────────────────────────────────────────

// Map of userId -> Set of recently used codes with timestamps
const usedCodes = new Map<string, Map<string, number>>();

// Codes expire after 2 minutes (4 windows of 30 seconds)
const CODE_EXPIRY_MS = 120_000;

function isCodeUsed(userId: string, code: string): boolean {
  const userCodes = usedCodes.get(userId);
  if (!userCodes) return false;

  const usedAt = userCodes.get(code);
  if (usedAt === undefined) return false;

  // Check if code has expired from replay tracking
  if (Date.now() - usedAt > CODE_EXPIRY_MS) {
    userCodes.delete(code);
    return false;
  }

  return true;
}

function markCodeUsed(userId: string, code: string): void {
  let userCodes = usedCodes.get(userId);
  if (!userCodes) {
    userCodes = new Map();
    usedCodes.set(userId, userCodes);
  }
  userCodes.set(code, Date.now());

  // Cleanup old entries
  for (const [c, ts] of userCodes.entries()) {
    if (Date.now() - ts > CODE_EXPIRY_MS) {
      userCodes.delete(c);
    }
  }
}

/**
 * Clear all replay tracking (for testing).
 */
export function _clearUsedCodes(): void {
  usedCodes.clear();
}

// ─── Recovery Code Generation ───────────────────────────────────────────────

/**
 * Generate 8 one-time recovery codes.
 * Format: XXXX-XXXX (alphanumeric, uppercase).
 */
export function generateRecoveryCodes(count: number = 8): string[] {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous: I,O,0,1
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let code = "";
    for (let j = 0; j < 8; j++) {
      code += chars[bytes[j] % chars.length];
    }
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }

  return codes;
}

// ─── TOTP Operations ────────────────────────────────────────────────────────

/**
 * Generate a new TOTP secret, QR URI, and recovery codes for a user.
 * Does NOT enable 2FA yet — call enableTotp() after the user verifies.
 */
export function generateTotpSecret(
  username: string,
  issuer: string = "PanelKit"
): TotpSetup {
  const secret = new Secret({ size: 20 });

  const totp = new TOTP({
    issuer,
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  const uri = totp.toString();
  const recoveryCodes = generateRecoveryCodes();

  return {
    secret: secret.base32,
    uri,
    recoveryCodes,
  };
}

/**
 * Validate a TOTP code against a secret.
 * Allows +-1 window (30 seconds) clock skew tolerance.
 */
export function validateTotpCode(
  secret: string,
  code: string,
  userId?: string
): boolean {
  if (!secret || !code) return false;

  // Check replay protection
  if (userId && isCodeUsed(userId, code)) {
    return false;
  }

  const totp = new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });

  // validate() returns the time step difference, or null if invalid
  // window: 1 allows +-1 period (30 seconds each direction)
  const delta = totp.validate({ token: code, window: 1 });

  if (delta !== null) {
    // Mark code as used for replay protection
    if (userId) {
      markCodeUsed(userId, code);
    }
    return true;
  }

  return false;
}

/**
 * Enable TOTP for a user. Stores the secret and recovery codes in DB.
 * Requires a valid TOTP code to confirm the setup.
 */
export async function enableTotp(
  userId: string,
  secret: string,
  code: string,
  recoveryCodes: string[],
  db?: AppDatabase
): Promise<void> {
  const database = db || getDb();

  // Verify the code first
  if (!validateTotpCode(secret, code)) {
    throw new TotpError(
      "Invalid TOTP code. Make sure your authenticator app is set up correctly.",
      400
    );
  }

  const user = await database.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new TotpError("User not found", 404);
  }

  if (user.totpEnabled) {
    throw new TotpError("Two-factor authentication is already enabled", 409);
  }

  // Store secret and recovery codes as JSON in totpSecret field
  const totpData = JSON.stringify({
    secret,
    recoveryCodes,
  });

  await database
    .update(users)
    .set({
      totpSecret: totpData,
      totpEnabled: true,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, userId));
}

/**
 * Disable TOTP for a user.
 */
export async function disableTotp(
  userId: string,
  db?: AppDatabase
): Promise<void> {
  const database = db || getDb();

  const user = await database.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new TotpError("User not found", 404);
  }

  if (!user.totpEnabled) {
    throw new TotpError("Two-factor authentication is not enabled", 400);
  }

  await database
    .update(users)
    .set({
      totpSecret: null,
      totpEnabled: false,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, userId));
}

/**
 * Verify a TOTP code or recovery code for a user during login.
 */
export async function verifyUserTotp(
  userId: string,
  code: string,
  db?: AppDatabase
): Promise<TotpValidation> {
  const database = db || getDb();

  const user = await database.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user || !user.totpEnabled || !user.totpSecret) {
    return { valid: false };
  }

  let totpData: { secret: string; recoveryCodes: string[] };
  try {
    totpData = JSON.parse(user.totpSecret);
  } catch {
    return { valid: false };
  }

  // Try TOTP code first
  if (validateTotpCode(totpData.secret, code, userId)) {
    return { valid: true };
  }

  // Try recovery codes (case-insensitive, normalized)
  const normalizedCode = code.toUpperCase().replace(/\s/g, "");
  const codeIndex = totpData.recoveryCodes.findIndex(
    (rc) => timingSafeEqual(rc.replace(/-/g, ""), normalizedCode.replace(/-/g, ""))
  );

  if (codeIndex !== -1) {
    // Remove the used recovery code
    totpData.recoveryCodes.splice(codeIndex, 1);

    await database
      .update(users)
      .set({
        totpSecret: JSON.stringify(totpData),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));

    return { valid: true, usedRecoveryCode: true };
  }

  return { valid: false };
}

// ─── Error Class ─────────────────────────────────────────────────────────────

export class TotpError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "TotpError";
  }
}
