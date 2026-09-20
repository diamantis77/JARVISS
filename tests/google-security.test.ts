import { afterEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../lib/google/token-crypto";
import { validOAuthState } from "../lib/google/oauth-state";
import { createDemoRepositories } from "../lib/repositories/demo";
import { watchNeedsRenewal } from "../lib/google/sync";

const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
afterEach(() => { if (originalKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY; else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey; });
describe("Google OAuth security", () => {
  it("rejects missing or mismatched OAuth state", () => { expect(validOAuthState(undefined, "x")).toBe(false); expect(validOAuthState("expected", "wrong")).toBe(false); expect(validOAuthState("expected", "expected")).toBe(true); });
  it("encrypts tokens with authenticated versioned ciphertext", () => { process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); const encrypted = encryptToken("refresh-secret"); expect(encrypted).toMatch(/^jgt1\./); expect(encrypted).not.toContain("refresh-secret"); expect(decryptToken(encrypted)).toBe("refresh-secret"); expect(() => decryptToken(`${encrypted.slice(0, -1)}x`)).toThrow(); });
  it("keeps connection tokens isolated per repository user", async () => { const a = createDemoRepositories(); const b = createDemoRepositories(); await a.connections.upsertGoogle({ provider: "google", providerAccountId: "a", providerEmail: "a@example.com", status: "connected", scopes: [], accessTokenEncrypted: "cipher-a", refreshTokenEncrypted: "cipher-r", tokenExpiresAt: null, lastSyncAt: null, errorCode: null, errorMessage: null }); expect((await a.connections.getGoogle())?.accessTokenEncrypted).toBe("cipher-a"); expect(await b.connections.getGoogle()).toBeNull(); });
  it("detects missing and expiring provider watches", () => { const now = Date.parse("2026-09-20T00:00:00Z"); expect(watchNeedsRenewal(null, now)).toBe(true); expect(watchNeedsRenewal("2026-09-20T12:00:00Z", now)).toBe(true); expect(watchNeedsRenewal("2026-09-23T00:00:00Z", now)).toBe(false); });
});
