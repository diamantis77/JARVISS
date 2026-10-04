import type { PhoneCall, PhoneNotificationSettings, PhoneCallStatus, TelephonyProviderName } from "@/types";

export interface ProviderValidationResult {
  credentialsValid: boolean;
  applicationValid: boolean;
  fromNumberAuthorized: boolean;
  ownerNumberReady: boolean;
  error: "not_configured" | "authentication_failed" | "application_invalid" | "number_not_authorized" | "owner_number_invalid" | "provider_unavailable" | null;
}

export interface OutboundCallRequest {
  phoneCallId: string;
  reason: string;
}

export interface OutboundCallResult {
  providerCallId: string;
  providerStatus: string;
}

export interface TelephonyProvider {
  readonly name: TelephonyProviderName;
  createOwnerCall(input: OutboundCallRequest): Promise<OutboundCallResult>;
  endCall(providerCallId: string): Promise<void>;
  getCall(providerCallId: string): Promise<{ providerCallId: string; providerStatus: string; durationSeconds: number | null }>;
}

export interface PhoneCallRepository {
  create(input: { userId: string; provider: TelephonyProviderName; reason: string; context?: Record<string, unknown>; deduplicationKey?: string | null }): Promise<PhoneCall>;
  get(id: string): Promise<PhoneCall | null>;
  getByProviderCallId(providerCallId: string): Promise<PhoneCall | null>;
  list(userId: string, limit?: number): Promise<PhoneCall[]>;
  update(id: string, patch: Partial<{ providerCallId: string; providerStatus: string; status: PhoneCallStatus; jarvisRunId: string; startedAt: string; answeredAt: string; endedAt: string; durationSeconds: number; liveSessionDurationSeconds: number; errorCategory: string; errorSummary: string }>): Promise<PhoneCall>;
  getSettings(userId: string): Promise<PhoneNotificationSettings>;
  updateSettings(userId: string, settings: PhoneNotificationSettings): Promise<PhoneNotificationSettings>;
}
