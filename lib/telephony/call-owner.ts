import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InternalEventType, PhoneNotificationSettings } from "@/types";
import { SupabaseJobQueue } from "../jobs/supabase-queue";
import { getSelectedTelephonyProvider, getTelephonyStatus } from "./config";
import { canPlacePhoneCall } from "./policy";
import { SupabasePhoneCallRepository } from "./repository";
import { validateTelephonyProviderConfiguration } from "./provider";
import { getPhoneLiveVoice } from "./phone-voice-config";

export async function queueOwnerCall(db: SupabaseClient, input: { userId: string; reason: string; context?: Record<string, unknown>; urgent?: boolean; verifiedCustomerReply?: boolean; correlationId?: string; deduplicationKey: string }) {
  try { getPhoneLiveVoice(); } catch { return { queued: false as const, reason: "The phone Live voice configuration is invalid." }; }
  const readiness = getTelephonyStatus();
  if (readiness.readiness !== "ready") return { queued: false as const, reason: "Telephony is not ready." };
  const provider = getSelectedTelephonyProvider();
  const providerValidation = await validateTelephonyProviderConfiguration(provider);
  if (!providerValidation.credentialsValid || !providerValidation.applicationValid || !providerValidation.fromNumberAuthorized || !providerValidation.ownerNumberReady) return { queued: false as const, reason: "The selected telephony provider is not ready for owner-only outbound calls." };
  const calls = new SupabasePhoneCallRepository(db);
  const [settings, businessResult] = await Promise.all([calls.getSettings(input.userId), db.from("settings").select("timezone").eq("user_id", input.userId).maybeSingle()]);
  if (businessResult.error) throw new Error("Unable to read owner timezone");
  const timezone = typeof businessResult.data?.timezone === "string" ? businessResult.data.timezone : "Europe/Athens";
  const policy = canPlacePhoneCall(settings, timezone, Boolean(input.urgent), new Date(), input.verifiedCustomerReply === true);
  if (!policy.allowed) return { queued: false as const, reason: policy.reason ?? "Phone policy blocked the call." };
  const call = await calls.create({ userId: input.userId, provider, reason: input.reason, context: input.context, deduplicationKey: input.deduplicationKey });
  const job = await new SupabaseJobQueue(db).enqueue({ userId: input.userId, jobType: "outbound_jarvis_call", payload: { phoneCallId: call.id }, priority: input.urgent ? 90 : 60, maxAttempts: 1, deduplicationKey: `dial:${call.id}`, correlationId: input.correlationId });
  return { queued: true as const, call, job };
}

type TriggerKey = keyof Pick<PhoneNotificationSettings, "morningBrief" | "hotLeadReply" | "importantCustomerReply" | "meetingSoon" | "criticalProviderFailure" | "highValueDeal" | "customPriorityEvent">;
const EVENT_TRIGGER: Partial<Record<InternalEventType, { key: TriggerKey; urgent: boolean; reason: string }>> = {
  DAILY_BRIEF_READY: { key: "morningBrief", urgent: false, reason: "MORNING_BRIEF" },
  HOT_LEAD_DETECTED: { key: "hotLeadReply", urgent: false, reason: "HOT_LEAD_REPLY" },
  LEAD_REPLIED: { key: "importantCustomerReply", urgent: false, reason: "IMPORTANT_CUSTOMER_REPLY" },
  MEETING_STARTING_SOON: { key: "meetingSoon", urgent: false, reason: "MEETING_SOON" },
  PROVIDER_DISCONNECTED: { key: "criticalProviderFailure", urgent: true, reason: "CRITICAL_PROVIDER_FAILURE" },
  HIGH_VALUE_DEAL: { key: "highValueDeal", urgent: false, reason: "HIGH_VALUE_DEAL" },
  CUSTOM_PRIORITY_EVENT: { key: "customPriorityEvent", urgent: false, reason: "CUSTOM_PRIORITY_EVENT" },
};

export async function queuePhoneForInternalEvent(db: SupabaseClient, input: { userId: string; eventType: InternalEventType; payload?: Record<string, unknown>; correlationId: string; deduplicationKey?: string | null; verifiedCustomerReply?: boolean }) {
  const trigger = EVENT_TRIGGER[input.eventType];
  if (!trigger) return { queued: false as const, reason: "Event is not phone-eligible." };
  const settings = await new SupabasePhoneCallRepository(db).getSettings(input.userId);
  if (!settings[trigger.key]) return { queued: false as const, reason: "This phone trigger is disabled." };
  const stableSource = input.deduplicationKey ?? `${input.correlationId}:${input.eventType}:${JSON.stringify(input.payload ?? {})}`;
  const digest = createHash("sha256").update(stableSource).digest("hex").slice(0, 24);
  return queueOwnerCall(db, { userId: input.userId, reason: trigger.reason, context: { ...(input.payload ?? {}), eventType: input.eventType }, urgent: trigger.urgent, verifiedCustomerReply: input.eventType === "LEAD_REPLIED" && input.verifiedCustomerReply === true, correlationId: input.correlationId, deduplicationKey: `phone-event:${digest}` });
}
