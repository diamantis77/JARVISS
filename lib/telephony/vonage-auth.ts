import { createHash, createHmac, createPrivateKey, createPublicKey, randomUUID, sign, timingSafeEqual, verify } from "node:crypto";
import type { VonageTelephonyConfig } from "./config";
import { getVonageConfig } from "./config";

type Json = Record<string, unknown>;
export interface VonageMediaClaims { provider: "vonage"; audience: "jarvis-vonage-media"; phoneCallId: string; providerCallId?: string; expiresAt: number; tokenId: string; }

function encode(value: string | Buffer) { return Buffer.from(value).toString("base64url"); }
function decodeJson(value: string): Json | null { try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Json; } catch { return null; } }
function signingInput(header: Json, payload: Json) { return `${encode(JSON.stringify(header))}.${encode(JSON.stringify(payload))}`; }

function createRs256Jwt(payload: Json, config: VonageTelephonyConfig) {
  const input = signingInput({ alg: "RS256", typ: "JWT" }, payload);
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), createPrivateKey(config.privateKey)).toString("base64url")}`;
}

export function createVonageApplicationJwt(config: VonageTelephonyConfig, ttlSeconds = 300) {
  const now = Math.floor(Date.now() / 1000);
  return createRs256Jwt({ application_id: config.applicationId, iat: now, exp: now + ttlSeconds, jti: randomUUID() }, config);
}

export function createVonageMediaAuthorization(phoneCallId: string, providerCallId?: string, ttlSeconds = 300) {
  const config = getVonageConfig();
  if (!config) throw new Error("Vonage is not configured");
  const now = Math.floor(Date.now() / 1000);
  return createRs256Jwt({ iss: "jarvis", aud: "jarvis-vonage-media", provider: "vonage", call_id: phoneCallId, provider_call_id: providerCallId, iat: now, exp: now + ttlSeconds, jti: randomUUID() }, config);
}

export function validateVonageMediaAuthorization(authorization?: string): VonageMediaClaims | null {
  const config = getVonageConfig();
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!config || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = decodeJson(parts[0]); const payload = decodeJson(parts[1]);
  if (header?.alg !== "RS256" || payload?.iss !== "jarvis" || payload?.aud !== "jarvis-vonage-media" || payload?.provider !== "vonage") return null;
  const exp = Number(payload.exp); const iat = Number(payload.iat); const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(exp) || !Number.isFinite(iat) || exp <= now || iat > now + 30 || exp - iat > 600) return null;
  const phoneCallId = typeof payload.call_id === "string" ? payload.call_id : "";
  const tokenId = typeof payload.jti === "string" ? payload.jti : "";
  if (!phoneCallId || !tokenId) return null;
  const valid = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(config.privateKey), Buffer.from(parts[2], "base64url"));
  return valid ? { provider: "vonage", audience: "jarvis-vonage-media", phoneCallId, providerCallId: typeof payload.provider_call_id === "string" ? payload.provider_call_id : undefined, expiresAt: exp, tokenId } : null;
}

export async function inspectVonageWebhookRequest(request: Request): Promise<{ valid: boolean; reason: string }> {
  const config = getVonageConfig();
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!config) return { valid: false, reason: "configuration_missing" };
  if (!token) return { valid: false, reason: "authorization_missing" };
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "token_malformed" };
  const header = decodeJson(parts[0]); const payload = decodeJson(parts[1]);
  if (header?.alg !== "HS256" || payload?.iss !== "Vonage") return { valid: false, reason: "token_claims_invalid" };
  const exp = Number(payload.exp); const iat = Number(payload.iat); const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(iat) || iat > now + 30 || now - iat > 300 || (Number.isFinite(exp) && exp < now)) return { valid: false, reason: "token_time_invalid" };
  if (payload.api_key !== undefined && payload.api_key !== config.apiKey) return { valid: false, reason: "api_key_mismatch" };
  if (payload.application_id !== undefined && payload.application_id !== config.applicationId) return { valid: false, reason: "application_mismatch" };
  const expected = createHmac("sha256", config.signatureSecret).update(`${parts[0]}.${parts[1]}`).digest();
  const actual = Buffer.from(parts[2], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { valid: false, reason: "signature_mismatch" };
  if (typeof payload.payload_hash === "string") {
    const body = await request.clone().text();
    const hash = createHash("sha256").update(body).digest("hex");
    if (hash.length !== payload.payload_hash.length || !timingSafeEqual(Buffer.from(hash), Buffer.from(payload.payload_hash))) return { valid: false, reason: "payload_hash_mismatch" };
  }
  return { valid: true, reason: "accepted" };
}

export async function validateVonageWebhookRequest(request: Request) {
  return (await inspectVonageWebhookRequest(request)).valid;
}
