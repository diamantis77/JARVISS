import { afterEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../lib/google/token-crypto";
import { validOAuthState } from "../lib/google/oauth-state";
import { matchesGoogleCallbackUrl } from "../lib/google/callback-url";
import { createDemoRepositories } from "../lib/repositories/demo";
import { watchNeedsRenewal } from "../lib/google/sync";
import { classifyMissionReply } from "../lib/missions/replies";

const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
afterEach(() => { if (originalKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY; else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey; });
describe("Google OAuth security", () => {
  it("rejects missing or mismatched OAuth state", () => { expect(validOAuthState(undefined, "x")).toBe(false); expect(validOAuthState("expected", "wrong")).toBe(false); expect(validOAuthState("expected", "expected")).toBe(true); });
  it("accepts the configured callback and only a matching local Host fallback in development", () => {
    const configured = "http://127.0.0.1:3000/api/integrations/google/callback";
    expect(matchesGoogleCallbackUrl(new Request(configured), configured, "development")).toBe(true);
    const internalUrl = "http://localhost:3000/api/integrations/google/callback";
    expect(matchesGoogleCallbackUrl(new Request(internalUrl, { headers: { host: "127.0.0.1:3000" } }), configured, "development")).toBe(true);
    expect(matchesGoogleCallbackUrl(new Request(internalUrl, { headers: { host: "evil.example" } }), configured, "development")).toBe(false);
    expect(matchesGoogleCallbackUrl(new Request(internalUrl, { headers: { host: "127.0.0.1:3000" } }), configured, "production")).toBe(false);
    expect(matchesGoogleCallbackUrl(new Request("http://localhost:3000/other", { headers: { host: "127.0.0.1:3000" } }), configured, "development")).toBe(false);
  });
  it("encrypts tokens with authenticated versioned ciphertext", () => { process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); const encrypted = encryptToken("refresh-secret"); expect(encrypted).toMatch(/^jgt1\./); expect(encrypted).not.toContain("refresh-secret"); expect(decryptToken(encrypted)).toBe("refresh-secret"); expect(() => decryptToken(`${encrypted.slice(0, -1)}x`)).toThrow(); });
  it("keeps connection tokens isolated per repository user", async () => { const a = createDemoRepositories(); const b = createDemoRepositories(); await a.connections.upsertGoogle({ provider: "google", providerAccountId: "a", providerEmail: "a@example.com", status: "connected", scopes: [], accessTokenEncrypted: "cipher-a", refreshTokenEncrypted: "cipher-r", tokenExpiresAt: null, lastSyncAt: null, errorCode: null, errorMessage: null }); expect((await a.connections.getGoogle())?.accessTokenEncrypted).toBe("cipher-a"); expect(await b.connections.getGoogle()).toBeNull(); });
  it("detects missing and expiring provider watches", () => { const now = Date.parse("2026-09-20T00:00:00Z"); expect(watchNeedsRenewal(null, now)).toBe(true); expect(watchNeedsRenewal("2026-09-20T12:00:00Z", now)).toBe(true); expect(watchNeedsRenewal("2026-09-23T00:00:00Z", now)).toBe(false); });
  it("classifies only explicit reply text, not a quoted sales subject", () => {
    expect(classifyMissionReply("Re: ενδιαφέρομαι", "Παρακαλώ μην επικοινωνήσετε ξανά.")).toBe("UNSUBSCRIBE");
    expect(classifyMissionReply("Re: προσφορά", "Δεν μας ενδιαφέρει.")).toBe("NOT_INTERESTED");
    expect(classifyMissionReply("Re: προσφορά", "Να κανονίσουμε ένα ραντεβού; ")).toBe("MEETING_REQUEST");
    expect(classifyMissionReply("Re: προσφορά", "Με ενδιαφέρει.")).toBe("INTERESTED");
    expect(classifyMissionReply("Re: προσφορά", "Πόσο κοστίζει; ")).toBe("QUESTION");
    expect(classifyMissionReply("Re: ενδιαφέρομαι", "Ευχαριστώ για το μήνυμα.")).toBe("UNCLEAR");
  });
});
