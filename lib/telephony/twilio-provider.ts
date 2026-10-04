import twilio from "twilio";
import type { ProviderValidationResult, TelephonyProvider } from "./contracts";
import { getTwilioConfig, telephonyWebhookUrl } from "./config";

let validationCache: { expiresAt: number; result: ProviderValidationResult } | null = null;

export async function validateTwilioConfiguration(force = false): Promise<ProviderValidationResult> {
  if (!force && validationCache && validationCache.expiresAt > Date.now()) return validationCache.result;
  const config = getTwilioConfig();
  if (!config) return { credentialsValid: false, applicationValid: false, fromNumberAuthorized: false, ownerNumberReady: false, error: "not_configured" };
  try {
    const client = twilio(config.accountSid, config.authToken);
    const account = await client.api.v2010.accounts(config.accountSid).fetch();
    const [incoming, outgoing] = await Promise.all([client.incomingPhoneNumbers.list({ limit: 100 }), client.outgoingCallerIds.list({ limit: 100 })]);
    const credentialsValid = account.status === "active";
    const fromNumberAuthorized = incoming.some((item) => item.phoneNumber === config.fromNumber) || outgoing.some((item) => item.phoneNumber === config.fromNumber);
    const ownerNumberReady = /^\+[1-9]\d{6,14}$/.test(config.ownerNumber);
    const result: ProviderValidationResult = { credentialsValid, applicationValid: credentialsValid, fromNumberAuthorized, ownerNumberReady, error: !credentialsValid ? "authentication_failed" : !fromNumberAuthorized ? "number_not_authorized" : !ownerNumberReady ? "owner_number_invalid" : null };
    validationCache = { expiresAt: Date.now() + 5 * 60_000, result };
    return result;
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : null;
    const result: ProviderValidationResult = { credentialsValid: false, applicationValid: false, fromNumberAuthorized: false, ownerNumberReady: false, error: status === 401 ? "authentication_failed" : "provider_unavailable" };
    validationCache = { expiresAt: Date.now() + 30_000, result };
    return result;
  }
}

export class TwilioTelephonyProvider implements TelephonyProvider {
  readonly name = "twilio" as const;
  private readonly config = getTwilioConfig();

  async createOwnerCall(input: { phoneCallId: string; reason: string }) {
    if (!this.config) throw new Error("Telephony is not configured");
    const client = twilio(this.config.accountSid, this.config.authToken);
    const call = await client.calls.create({
      to: this.config.ownerNumber,
      from: this.config.fromNumber,
      url: telephonyWebhookUrl(`/api/telephony/twilio/voice?callId=${encodeURIComponent(input.phoneCallId)}`),
      method: "POST",
      statusCallback: telephonyWebhookUrl(`/api/telephony/twilio/status?callId=${encodeURIComponent(input.phoneCallId)}`),
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      timeout: 30,
    });
    return { providerCallId: call.sid, providerStatus: call.status };
  }

  async endCall(providerCallId: string) {
    if (!this.config) throw new Error("Telephony is not configured");
    const client = twilio(this.config.accountSid, this.config.authToken);
    await client.calls(providerCallId).update({ status: "completed" });
  }

  async getCall(providerCallId: string) {
    if (!this.config) throw new Error("Telephony is not configured");
    const client = twilio(this.config.accountSid, this.config.authToken);
    const call = await client.calls(providerCallId).fetch();
    return { providerCallId: call.sid, providerStatus: call.status, durationSeconds: call.duration ? Number(call.duration) : null };
  }
}
