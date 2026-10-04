import { createHmac, timingSafeEqual } from "node:crypto";
import twilio from "twilio";
import { getTwilioConfig, telephonyWebhookUrl } from "./config";

export async function validateTwilioFormRequest(request: Request, path: string) {
  const config = getTwilioConfig();
  if (!config) return { valid: false as const, status: 503, params: {} as Record<string, string> };
  const body = await request.text();
  const form = new URLSearchParams(body);
  const params = Object.fromEntries(form.entries());
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const incoming = new URL(request.url);
  const signedUrl = `${telephonyWebhookUrl(path)}${incoming.search}`;
  const valid = Boolean(signature) && twilio.validateRequest(config.authToken, signature, signedUrl, params);
  return { valid, status: valid ? 200 : 403, params };
}

export function validateTwilioUpgrade(signature: string | undefined, pathnameWithQuery: string) {
  const config = getTwilioConfig();
  if (!config || !signature) return false;
  const signedUrl = telephonyWebhookUrl(pathnameWithQuery).replace(/^https:/i, "wss:");
  return twilio.validateRequest(config.authToken, signature, signedUrl, {})
    || (!signedUrl.endsWith("/") && twilio.validateRequest(config.authToken, signature, `${signedUrl}/`, {}));
}

function mediaSignature(callId: string, expires: number, secret: string) { return createHmac("sha256", secret).update(`${callId}.${expires}`).digest("base64url"); }

export function createMediaToken(callId: string, ttlSeconds = 300) {
  const config = getTwilioConfig();
  if (!config) throw new Error("Telephony is not configured");
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${expires}.${mediaSignature(callId, expires, config.authToken)}`;
}

export function validateMediaToken(callId: string, token: string) {
  const config = getTwilioConfig();
  if (!config) return false;
  const [rawExpires, supplied] = token.split(".");
  const expires = Number(rawExpires);
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || !supplied) return false;
  const expected = mediaSignature(callId, expires, config.authToken);
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
