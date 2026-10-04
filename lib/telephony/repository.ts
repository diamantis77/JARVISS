import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhoneCall, PhoneNotificationSettings } from "@/types";
import type { PhoneCallRepository } from "./contracts";
import { DEFAULT_PHONE_SETTINGS } from "./policy";

function mapCall(row: Record<string, unknown>): PhoneCall {
  return {
    id: String(row.id), userId: String(row.user_id), direction: "outbound", provider: row.provider === "vonage" ? "vonage" : "twilio",
    providerCallId: row.provider_call_id ? String(row.provider_call_id) : null,
    providerStatus: row.provider_status ? String(row.provider_status) : null,
    status: row.status as PhoneCall["status"], reason: String(row.reason),
    context: row.context_json && typeof row.context_json === "object" ? row.context_json as Record<string, unknown> : {},
    jarvisRunId: row.jarvis_run_id ? String(row.jarvis_run_id) : null,
    startedAt: row.started_at ? String(row.started_at) : null, answeredAt: row.answered_at ? String(row.answered_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined ? null : Number(row.duration_seconds),
    liveSessionDurationSeconds: row.live_session_duration_seconds === null || row.live_session_duration_seconds === undefined ? null : Number(row.live_session_duration_seconds),
    errorCategory: row.error_category ? String(row.error_category) : null,
    errorSummary: row.error_summary ? String(row.error_summary) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapSettings(row?: Record<string, unknown> | null): PhoneNotificationSettings {
  if (!row) return DEFAULT_PHONE_SETTINGS;
  return {
    enabled: Boolean(row.enabled), allowedStart: String(row.allowed_start), allowedEnd: String(row.allowed_end),
    outsideHours: row.outside_hours === "urgent_only" ? "urgent_only" : "never",
    customerReplyOutsideHours: row.customer_reply_outside_hours === true,
    morningBrief: Boolean(row.morning_brief), hotLeadReply: Boolean(row.hot_lead), importantCustomerReply: Boolean(row.important_customer_reply), meetingSoon: Boolean(row.meeting_soon),
    criticalProviderFailure: Boolean(row.important_failure), highValueDeal: Boolean(row.high_value_deal), customPriorityEvent: Boolean(row.custom_priority_event), maxCallMinutes: Number(row.max_call_minutes),
  };
}

function requireRow(data: unknown, error: { message?: string } | null, action: string) {
  if (error || !data) throw new Error(`${action} failed`);
  return data as Record<string, unknown>;
}

export class SupabasePhoneCallRepository implements PhoneCallRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(input: Parameters<PhoneCallRepository["create"]>[0]) {
    const row = { user_id: input.userId, provider: input.provider, reason: input.reason, context_json: input.context ?? {}, deduplication_key: input.deduplicationKey ?? null };
    const { data, error } = await this.db.from("phone_calls").insert(row).select().single();
    if (!error && data) return mapCall(data);
    if (input.deduplicationKey) {
      const existing = await this.db.from("phone_calls").select("*").eq("deduplication_key", input.deduplicationKey).maybeSingle();
      if (existing.data) return mapCall(existing.data);
    }
    throw new Error("Unable to create phone call record");
  }

  async get(id: string) { const { data, error } = await this.db.from("phone_calls").select("*").eq("id", id).maybeSingle(); if (error) throw new Error("Unable to read phone call"); return data ? mapCall(data) : null; }
  async getByProviderCallId(providerCallId: string) { const { data, error } = await this.db.from("phone_calls").select("*").eq("provider_call_id", providerCallId).maybeSingle(); if (error) throw new Error("Unable to read provider call"); return data ? mapCall(data) : null; }
  async list(userId: string, limit = 20) { const { data, error } = await this.db.from("phone_calls").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(Math.min(limit, 100)); if (error) throw new Error("Unable to list phone calls"); return (data ?? []).map(mapCall); }

  async update(id: string, patch: Parameters<PhoneCallRepository["update"]>[1]) {
    const row: Record<string, unknown> = {};
    if (patch.providerCallId !== undefined) row.provider_call_id = patch.providerCallId;
    if (patch.providerStatus !== undefined) row.provider_status = patch.providerStatus;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.jarvisRunId !== undefined) row.jarvis_run_id = patch.jarvisRunId;
    if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
    if (patch.answeredAt !== undefined) row.answered_at = patch.answeredAt;
    if (patch.endedAt !== undefined) row.ended_at = patch.endedAt;
    if (patch.durationSeconds !== undefined) row.duration_seconds = patch.durationSeconds;
    if (patch.liveSessionDurationSeconds !== undefined) row.live_session_duration_seconds = patch.liveSessionDurationSeconds;
    if (patch.errorCategory !== undefined) row.error_category = patch.errorCategory;
    if (patch.errorSummary !== undefined) row.error_summary = patch.errorSummary;
    const { data, error } = await this.db.from("phone_calls").update(row).eq("id", id).select().single();
    return mapCall(requireRow(data, error, "phone_calls.update"));
  }

  async getSettings(userId: string) { const { data, error } = await this.db.from("phone_notification_settings").select("*").eq("user_id", userId).maybeSingle(); if (error) throw new Error("Unable to read phone settings"); return mapSettings(data); }
  async updateSettings(userId: string, settings: PhoneNotificationSettings) {
    const row = { user_id: userId, enabled: settings.enabled, allowed_start: settings.allowedStart, allowed_end: settings.allowedEnd, outside_hours: settings.outsideHours, customer_reply_outside_hours: settings.customerReplyOutsideHours, morning_brief: settings.morningBrief, hot_lead: settings.hotLeadReply, important_customer_reply: settings.importantCustomerReply, meeting_soon: settings.meetingSoon, important_failure: settings.criticalProviderFailure, high_value_deal: settings.highValueDeal, custom_priority_event: settings.customPriorityEvent, max_call_minutes: settings.maxCallMinutes };
    const { data, error } = await this.db.from("phone_notification_settings").upsert(row).select().single();
    // Before migration 0014, existing phone preferences must remain editable,
    // but the new after-hours exception must never be silently accepted.
    if (error && !settings.customerReplyOutsideHours && ["PGRST204", "42703"].includes(error.code ?? "")) {
      const { customer_reply_outside_hours: _newSetting, ...legacyRow } = row;
      void _newSetting;
      const legacy = await this.db.from("phone_notification_settings").upsert(legacyRow).select().single();
      return mapSettings(requireRow(legacy.data, legacy.error, "phone_settings.update"));
    }
    return mapSettings(requireRow(data, error, "phone_settings.update"));
  }
}
