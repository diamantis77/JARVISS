import { createAdminClient } from "@/lib/supabase/admin";
import { SupabasePhoneCallRepository } from "@/lib/telephony/repository";
import { telephonyWebSocketUrl } from "@/lib/telephony/config";
import { createVonageMediaAuthorization, inspectVonageWebhookRequest } from "@/lib/telephony/vonage-auth";
import { logPhoneDiagnostic } from "@/lib/telephony/diagnostics";
import { mayApplyPhoneStatus } from "@/lib/telephony/status";

export async function POST(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId") ?? "";
  const authentication = await inspectVonageWebhookRequest(request);
  if (!callId || !authentication.valid) {
    logPhoneDiagnostic("vonage_answer_rejected", { callIdPresent: Boolean(callId), reason: !callId ? "call_id_missing" : authentication.reason });
    return new Response("Forbidden", { status: 403 });
  }
  const payload = await request.json().catch(() => null) as { uuid?: string; status?: string } | null;
  const providerCallId = payload?.uuid ?? "";
  const repository = new SupabasePhoneCallRepository(createAdminClient());
  const call = await repository.get(callId).catch(() => null);
  if (!call || call.provider !== "vonage" || !providerCallId || (call.providerCallId && call.providerCallId !== providerCallId)) {
    logPhoneDiagnostic("vonage_answer_rejected", { callIdPresent: true, reason: !call ? "call_not_found" : !providerCallId ? "provider_call_id_missing" : "call_mismatch" });
    return new Response("Forbidden", { status: 403 });
  }
  logPhoneDiagnostic("vonage_answer_callback", { phoneCallId: call.id, providerCallId, authenticated: true });
  if (mayApplyPhoneStatus(call.status, "in_progress")) {
    await repository.update(call.id, { providerCallId, providerStatus: payload?.status ?? "answered", status: "in_progress", answeredAt: call.answeredAt ?? new Date().toISOString() });
    logPhoneDiagnostic("phone_lifecycle_transition", { phoneCallId: call.id, from: call.status.toUpperCase(), to: "ANSWERED", cause: "vonage_answer_callback" });
  }
  const authorization = `Bearer ${createVonageMediaAuthorization(call.id, providerCallId)}`;
  return Response.json([{ action: "connect", endpoint: [{ type: "websocket", uri: telephonyWebSocketUrl("/api/telephony/vonage/media"), "content-type": "audio/l16;rate=16000", headers: { provider: "vonage", callId: call.id }, authorization: { type: "custom", value: authorization } }] }], { headers: { "Cache-Control": "no-store" } });
}
