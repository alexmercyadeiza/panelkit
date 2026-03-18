import { describe, it, expect, beforeEach } from "bun:test";
import { createTestDb, resetTestState } from "../helpers/setup";
import { validSetupInput } from "../helpers/fixtures";
import { setup } from "../../server/services/auth.service";
import type { AppDatabase } from "../../server/db";
import * as OTPAuth from "otpauth";
import {
  generateTotpSecret,
  validateTotpCode,
  enableTotp,
  disableTotp,
  verifyUserTotp,
  generateRecoveryCodes,
  _clearUsedCodes,
  TotpError,
} from "../../server/services/totp.service";

let db: AppDatabase;
let userId: string;

beforeEach(async () => {
  db = createTestDb();
  resetTestState();
  _clearUsedCodes();

  const result = await setup(db, validSetupInput);
  userId = result.user.id;
});

describe("TOTP — Secret Generation", () => {
  it("generates secret and QR URI", () => {
    const result = generateTotpSecret("admin", "PanelKit");

    expect(result.secret).toBeDefined();
    expect(result.secret.length).toBeGreaterThan(0);
    expect(result.uri).toContain("otpauth://totp/");
    expect(result.uri).toContain("PanelKit");
    expect(result.recoveryCodes).toHaveLength(8);
  });
});

describe("TOTP — Code Validation", () => {
  it("valid code accepted", () => {
    const { secret } = generateTotpSecret("admin");

    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    const code = totp.generate();

    const valid = validateTotpCode(secret, code);
    expect(valid).toBe(true);
  });

  it("invalid code rejected", () => {
    const { secret } = generateTotpSecret("admin");
    const valid = validateTotpCode(secret, "000000");
    expect(valid).toBe(false);
  });

  it("code reuse rejected when userId provided (replay protection)", () => {
    const { secret } = generateTotpSecret("admin");
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    const code = totp.generate();

    // First use should work (with userId for replay tracking)
    expect(validateTotpCode(secret, code, "test-user")).toBe(true);

    // Second use of same code should be rejected
    expect(validateTotpCode(secret, code, "test-user")).toBe(false);
  });
});

describe("TOTP — Recovery Codes", () => {
  it("generates requested number of recovery codes", () => {
    const codes = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);
  });

  it("all codes are unique", () => {
    const codes = generateRecoveryCodes(8);
    const unique = new Set(codes);
    expect(unique.size).toBe(8);
  });

  it("codes are in XXXX-XXXX format", () => {
    const codes = generateRecoveryCodes(8);
    for (const code of codes) {
      // Format: XXXX-XXXX (uppercase alphanumeric)
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    }
  });
});

describe("TOTP — Enable/Disable", () => {
  it("enabling 2FA requires valid code confirmation", async () => {
    const { secret, recoveryCodes } = generateTotpSecret("admin");

    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    const code = totp.generate();

    await enableTotp(userId, secret, code, recoveryCodes, db);

    const { users } = await import("../../server/db/schema");
    const { eq } = await import("drizzle-orm");
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    expect(user!.totpEnabled).toBe(true);
    expect(user!.totpSecret).toBeDefined();
  });

  it("enabling with wrong code fails", async () => {
    const { secret, recoveryCodes } = generateTotpSecret("admin");

    try {
      await enableTotp(userId, secret, "000000", recoveryCodes, db);
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TotpError);
    }
  });

  it("disabling 2FA works", async () => {
    const { secret, recoveryCodes } = generateTotpSecret("admin");
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    const code = totp.generate();

    await enableTotp(userId, secret, code, recoveryCodes, db);

    // disableTotp takes (userId, db) — no code required in this API
    await disableTotp(userId, db);

    const { users } = await import("../../server/db/schema");
    const { eq } = await import("drizzle-orm");
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    expect(user!.totpEnabled).toBe(false);
    expect(user!.totpSecret).toBeNull();
  });
});

describe("TOTP — Login Flow", () => {
  it("verifyUserTotp accepts valid TOTP code", async () => {
    const { secret, recoveryCodes } = generateTotpSecret("admin");
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });
    const code = totp.generate();

    await enableTotp(userId, secret, code, recoveryCodes, db);

    _clearUsedCodes();
    const loginCode = totp.generate();
    const result = await verifyUserTotp(userId, loginCode, db);
    expect(result.valid).toBe(true);
  });

  it("verifyUserTotp rejects wrong code", async () => {
    const { secret, recoveryCodes } = generateTotpSecret("admin");
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) });

    await enableTotp(userId, secret, totp.generate(), recoveryCodes, db);

    _clearUsedCodes();
    const result = await verifyUserTotp(userId, "000000", db);
    expect(result.valid).toBe(false);
  });
});
