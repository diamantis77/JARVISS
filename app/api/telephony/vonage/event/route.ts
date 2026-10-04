import { createAdminClient } from "@/lib/supabase/admin";
import { SupabasePhoneCallRepository } from "@/lib/telephony/repository";
import { inspectVonageWebhookRequest } from "@/lib/telephony/vonage-auth";
import { mayApplyPhoneStatus, normalizeVonageCallStatus, TERMINAL_PHONE_STATUSES } from "@/lib/telephony/status";
import { logPhoneDiagnostic, safeDiagnosticCode } from "@/lib/telephony/diagnostics";

export async function POST(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId") ?? "";
  const authentication = await inspectVonageWebhookRequest(request);
  if (!callId || !authentication.valid) {
    logPhoneDiagnostic("vonage_event_rejected", { callIdPresent: Boolean(callId), reason: !callId ? "call_id_missing" : authentication.reason });
    return new Response("Forbidden", { status: 403 });
  }
  const payload = await request.json().catch(() => null) as { uuid?: string; status?: string; duration?: string | number; timestamp?: string } | null;
  const providerCallId = payload?.uuid ?? ""; const providerStatus = payload?.status ?? "unknown";
  const repository = new SupabasePhoneCallRepository(createAdminClient()); const call = await repository.get(callId).catch(() => null);
  if (!call || call.provider !== "vonage" || (call.providerCallId && call.providerCallId !== providerCallId)) {
    logPhoneDiagnostic("vonage_event_rejected", { callIdPresent: true, reason: !call ? "call_not_found" : "call_mismatch" });
    return new Response("Forbidden", { status: 403 });
  }
  logPhoneDiagnostic("vonage_event_callback", { phoneCallId: call.id, providerCallId: providerCallId || null, status: safeDiagnosticCode(providerStatus), providerTimestamp: payload?.timestamp && Number.isFinite(Date.parse(payload.timestamp)) ? new Date(payload.timestamp).toISOString() : null, authenticated: true });
  const status = normalizeVonageCallStatus(providerStatus); if (!mayApplyPhoneStatus(call.status, status)) return new Response(null, { status: 204 });
  logPhoneDiagnostic("phone_lifecycle_transition", { phoneCallId: call.id, from: call.status.toUpperCase(), to: status.toUpperCase(), cause: "vonage_event_callback" });
  const now = new Date().toISOString();
  await repository.update(call.id, { ...(call.providerCallId ? {} : { providerCallId }), providerStatus, status, ...(status === "in_progress" && !call.answeredAt ? { answeredAt: now } : {}), ...(TERMINAL_PHONE_STATUSES.has(status) ? { endedAt: now, durationSeconds: Number(payload?.duration ?? 0) || 0 } : {}), ...(status === "failed" ? { errorCategory: "provider", errorSummary: "The provider could not complete the call." } : {}) });
  return new Response(null, { status: 204 });
}
