import fs from "node:fs";
import path from "node:path";
import type { TelephonyProviderName, TelephonyStatus } from "@/types";

export interface CommonTelephonyConfig {
  ownerNumber: string;
  publicBaseUrl: string;
}

export interface TwilioTelephonyConfig extends CommonTelephonyConfig {
  provider: "twilio";
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export interface VonageTelephonyConfig extends CommonTelephonyConfig {
  provider: "vonage";
  apiKey: string;
  apiSecret: string;
  applicationId: string;
  privateKey: string;
  signatureSecret: string;
  fromNumber: string;
}

export type TelephonyConfig = TwilioTelephonyConfig | VonageTelephonyConfig;
export const VONAGE_TEST_CALLER_ID = "123456789";

function cleanBaseUrl(value: string) { return value.trim().replace(/\/+$/, ""); }
function mask(value?: string) { return value?.trim() ? `••••${value.trim().replace(/\D/g, "").slice(-4)}` : null; }

export function isExternallyReachableHttps(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export function getSelectedTelephonyProvider(): TelephonyProviderName {
  return process.env.TELEPHONY_PROVIDER?.trim().toLowerCase() === "vonage" ? "vonage" : "twilio";
}

export function isVonageDevelopmentTestCallAllowed(fromNumber: string, destination: string) {
  const ownerNumber = process.env.JARVIS_OWNER_PHONE_NUMBER?.trim();
  return getSelectedTelephonyProvider() === "vonage"
    && (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")
    && process.env.VONAGE_DEVELOPMENT_TEST_MODE === "true"
    && fromNumber === VONAGE_TEST_CALLER_ID
    && Boolean(ownerNumber && /^\+[1-9]\d{6,14}$/.test(ownerNumber))
    && destination === ownerNumber;
}

function commonConfig(): CommonTelephonyConfig | null {
  const ownerNumber = process.env.JARVIS_OWNER_PHONE_NUMBER?.trim();
  const publicBaseUrl = process.env.PUBLIC_TELEPHONY_BASE_URL ? cleanBaseUrl(process.env.PUBLIC_TELEPHONY_BASE_URL) : "";
  if (!ownerNumber || !publicBaseUrl) return null;
  return { ownerNumber, publicBaseUrl };
}

export function getTwilioConfig(): TwilioTelephonyConfig | null {
  const common = commonConfig();
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!common || !accountSid || !authToken || !fromNumber) return null;
  return { provider: "twilio", accountSid, authToken, fromNumber, ...common };
}

function normalizePrivateKey(value: string) {
  const inline = value.trim().replace(/\\n/g, "\n");
  if (inline.includes("BEGIN PRIVATE KEY") || inline.includes("BEGIN RSA PRIVATE KEY")) return inline;
  const filePath = path.isAbsolute(inline) ? inline : path.resolve(process.cwd(), inline);
  return fs.readFileSync(filePath, "utf8").trim();
}

export function getVonageConfig(): VonageTelephonyConfig | null {
  const common = commonConfig();
  const apiKey = process.env.VONAGE_API_KEY?.trim();
  const apiSecret = process.env.VONAGE_API_SECRET?.trim();
  const applicationId = process.env.VONAGE_APPLICATION_ID?.trim();
  const privateKeyValue = process.env.VONAGE_PRIVATE_KEY?.trim();
  const signatureSecret = process.env.VONAGE_API_SIGNATURE_SECRET?.trim();
  const fromNumber = process.env.VONAGE_PHONE_NUMBER?.trim();
  if (!common || !apiKey || !apiSecret || !applicationId || !privateKeyValue || !signatureSecret || !fromNumber) return null;
  try {
    return { provider: "vonage", apiKey, apiSecret, applicationId, privateKey: normalizePrivateKey(privateKeyValue), signatureSecret, fromNumber, ...common };
  } catch { return null; }
}

export function getTelephonyConfig(provider: TelephonyProviderName = getSelectedTelephonyProvider()): TelephonyConfig | null {
  return provider === "vonage" ? getVonageConfig() : getTwilioConfig();
}

export function getTelephonyStatus(lastError: string | null = null): TelephonyStatus {
  const provider = getSelectedTelephonyProvider();
  const config = getTelephonyConfig(provider);
  const ownerNumberConfigured = Boolean(process.env.JARVIS_OWNER_PHONE_NUMBER?.trim());
  const base = process.env.PUBLIC_TELEPHONY_BASE_URL?.trim() ?? "";
  const publicEndpointConfigured = isExternallyReachableHttps(base);
  const credentialsConfigured = provider === "vonage"
    ? Boolean(process.env.VONAGE_API_KEY?.trim() && process.env.VONAGE_API_SECRET?.trim() && process.env.VONAGE_APPLICATION_ID?.trim() && process.env.VONAGE_PRIVATE_KEY?.trim() && process.env.VONAGE_API_SIGNATURE_SECRET?.trim())
    : Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim());
  const applicationConfigured = provider === "vonage" ? Boolean(process.env.VONAGE_APPLICATION_ID?.trim() && process.env.VONAGE_PRIVATE_KEY?.trim()) : true;
  const vonageNumber = process.env.VONAGE_PHONE_NUMBER?.trim();
  const callerNumberConfigured = provider === "vonage"
    ? Boolean(vonageNumber && (vonageNumber !== VONAGE_TEST_CALLER_ID || isVonageDevelopmentTestCallAllowed(vonageNumber, process.env.JARVIS_OWNER_PHONE_NUMBER?.trim() ?? "")))
    : Boolean(process.env.TWILIO_PHONE_NUMBER?.trim());
  const openAiBridgeConfigured = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_VOICE_MODEL?.trim());
  const readiness = !config || !credentialsConfigured || !callerNumberConfigured || !ownerNumberConfigured
    ? "not_configured"
    : !publicEndpointConfigured
      ? "public_endpoint_missing"
      : !openAiBridgeConfigured || lastError
        ? "degraded"
        : "ready";
  const health = readiness === "ready" ? "healthy" : readiness;
  const maskedTwilioNumber = mask(process.env.TWILIO_PHONE_NUMBER);
  const maskedVonageNumber = mask(process.env.VONAGE_PHONE_NUMBER);
  return {
    readiness, health, provider, credentialsConfigured, applicationConfigured, callerNumberConfigured,
    ownerNumberConfigured, publicEndpointConfigured, openAiBridgeConfigured,
    maskedProviderNumber: provider === "vonage" ? maskedVonageNumber : maskedTwilioNumber,
    maskedTwilioNumber, maskedVonageNumber, maskedOwnerNumber: mask(process.env.JARVIS_OWNER_PHONE_NUMBER),
    liveTestEnabled: provider === "vonage" ? process.env.RUN_LIVE_VONAGE_TESTS === "true" : process.env.RUN_LIVE_TWILIO_TESTS === "true",
    lastError,
  };
}

export function telephonyWebhookUrl(pathname: string) {
  const base = process.env.PUBLIC_TELEPHONY_BASE_URL?.trim();
  if (!base || !isExternallyReachableHttps(base)) throw new Error("Public telephony endpoint is not configured");
  return `${cleanBaseUrl(base)}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

export function telephonyWebSocketUrl(pathname: string) {
  return telephonyWebhookUrl(pathname).replace(/^https:/i, "wss:");
}
