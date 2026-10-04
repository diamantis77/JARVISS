import type { ProviderValidationResult, TelephonyProvider } from "./contracts";
import { getVonageConfig, isVonageDevelopmentTestCallAllowed, telephonyWebhookUrl, VONAGE_TEST_CALLER_ID } from "./config";
import { createVonageApplicationJwt } from "./vonage-auth";

type VonageNumber = { msisdn?: string; features?: string[]; app_id?: string };
let validationCache: { expiresAt: number; result: ProviderValidationResult } | null = null;
function digits(value: string) { return value.replace(/\D/g, ""); }

async function vonageRequest(path: string, init: RequestInit = {}) {
  const config = getVonageConfig();
  if (!config) throw new Error("not_configured");
  const response = await fetch(`https://api.nexmo.com${path}`, { ...init, headers: { Authorization: `Bearer ${createVonageApplicationJwt(config)}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "authentication_failed" : "provider_unavailable");
  return response;
}

export async function validateVonageConfiguration(force = false): Promise<ProviderValidationResult> {
  if (!force && validationCache && validationCache.expiresAt > Date.now()) return validationCache.result;
  const config = getVonageConfig();
  if (!config) return { credentialsValid: false, applicationValid: false, fromNumberAuthorized: false, ownerNumberReady: false, error: "not_configured" };
  try {
    await vonageRequest("/v1/calls?page_size=1");
    const basic = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64");
    const credentialCheck = await fetch("https://rest.nexmo.com/account/get-balance", { headers: { Authorization: `Basic ${basic}` } });
    if (!credentialCheck.ok) throw new Error(credentialCheck.status === 401 || credentialCheck.status === 403 ? "authentication_failed" : "provider_unavailable");
    let fromNumberAuthorized: boolean;
    if (config.fromNumber === VONAGE_TEST_CALLER_ID) {
      // Vonage documents this test caller ID only for a trial/demo account's sign-up phone.
      // The owner destination and explicit local development mode are mandatory.
      fromNumberAuthorized = isVonageDevelopmentTestCallAllowed(config.fromNumber, config.ownerNumber);
    } else {
      const response = await fetch(`https://rest.nexmo.com/account/numbers?pattern=${encodeURIComponent(digits(config.fromNumber))}&search_pattern=1&size=100`, { headers: { Authorization: `Basic ${basic}` } });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "authentication_failed" : "provider_unavailable");
      const data = await response.json() as { numbers?: VonageNumber[] };
      const configured = digits(config.fromNumber);
      fromNumberAuthorized = Boolean(data.numbers?.some((number) => digits(number.msisdn ?? "") === configured && (number.features ?? []).some((feature) => feature.toUpperCase().includes("VOICE"))));
    }
    const ownerNumberReady = /^\+[1-9]\d{6,14}$/.test(config.ownerNumber);
    const result: ProviderValidationResult = { credentialsValid: true, applicationValid: true, fromNumberAuthorized, ownerNumberReady, error: !fromNumberAuthorized ? "number_not_authorized" : !ownerNumberReady ? "owner_number_invalid" : null };
    validationCache = { expiresAt: Date.now() + 300_000, result }; return result;
  } catch (error) {
    const category = error instanceof Error && error.message === "authentication_failed" ? "authentication_failed" : "provider_unavailable";
    const result: ProviderValidationResult = { credentialsValid: false, applicationValid: false, fromNumberAuthorized: false, ownerNumberReady: false, error: category };
    validationCache = { expiresAt: Date.now() + 30_000, result }; return result;
  }
}

export class VonageTelephonyProvider implements TelephonyProvider {
  readonly name = "vonage" as const;
  private readonly config = getVonageConfig();
  async createOutboundCall(input: { phoneCallId: string; reason: string }) {
    if (!this.config) throw new Error("Vonage is not configured");
    if (this.config.fromNumber === VONAGE_TEST_CALLER_ID && !isVonageDevelopmentTestCallAllowed(this.config.fromNumber, this.config.ownerNumber)) throw new Error("Vonage development caller ID is not permitted for this destination");
    const validation = await validateVonageConfiguration(true);
    if (!validation.credentialsValid || !validation.applicationValid || !validation.fromNumberAuthorized || !validation.ownerNumberReady) throw new Error("Vonage caller ID or owner destination is not authorized");
    const response = await vonageRequest("/v1/calls", { method: "POST", body: JSON.stringify({
      to: [{ type: "phone", number: digits(this.config.ownerNumber) }], from: { type: "phone", number: digits(this.config.fromNumber) },
      answer_url: [telephonyWebhookUrl(`/api/telephony/vonage/answer?callId=${encodeURIComponent(input.phoneCallId)}`)], answer_method: "POST",
      event_url: [telephonyWebhookUrl(`/api/telephony/vonage/event?callId=${encodeURIComponent(input.phoneCallId)}`)], event_method: "POST",
    }) });
    const call = await response.json() as { uuid: string; status?: string };
    return { providerCallId: call.uuid, providerStatus: call.status ?? "started" };
  }
  createOwnerCall(input: { phoneCallId: string; reason: string }) { return this.createOutboundCall(input); }
  async endCall(providerCallId: string) { await vonageRequest(`/v1/calls/${encodeURIComponent(providerCallId)}`, { method: "PUT", body: JSON.stringify({ action: "hangup" }) }); }
  async getCall(providerCallId: string) { const response = await vonageRequest(`/v1/calls/${encodeURIComponent(providerCallId)}`); const call = await response.json() as { uuid: string; status: string; duration?: string | number }; return { providerCallId: call.uuid, providerStatus: call.status, durationSeconds: call.duration === undefined ? null : Number(call.duration) }; }
}
