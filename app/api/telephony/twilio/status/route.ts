import { createAdminClient } from "@/lib/supabase/admin";
import { SupabasePhoneCallRepository } from "@/lib/telephony/repository";
import { validateTwilioFormRequest } from "@/lib/telephony/security";
import { mayApplyPhoneStatus, normalizeTwilioCallStatus, TERMINAL_PHONE_STATUSES } from "@/lib/telephony/status";


export async function POST(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId") ?? "";
  const checked = await validateTwilioFormRequest(request, "/api/telephony/twilio/status");
  if (!checked.valid || !callId) return new Response("Forbidden", { status: checked.status });
  const repository = new SupabasePhoneCallRepository(createAdminClient());
  const call = await repository.get(callId).catch(() => null);
  const providerCallId = checked.params.CallSid ?? "";
  if (!call || call.provider !== "twilio" || (call.providerCallId && call.providerCallId !== providerCallId)) return new Response("Forbidden", { status: 403 });
  const streamEvent = checked.params.StreamEvent;
  if (streamEvent) {
    await repository.update(call.id, streamEvent === "stream-error"
      ? { providerStatus: streamEvent, status: "failed", endedAt: new Date().toISOString(), errorCategory: "media", errorSummary: "Twilio could not maintain the secure media stream." }
      : { providerStatus: streamEvent });
    return new Response(null, { status: 204 });
  }
  const providerStatus = checked.params.CallStatus ?? "unknown";
  const status = normalizeTwilioCallStatus(providerStatus);
  const now = new Date().toISOString();
  if (!mayApplyPhoneStatus(call.status, status)) return new Response(null, { status: 204 });
  if (TERMINAL_PHONE_STATUSES.has(call.status)) {
    await repository.update(call.id, { providerStatus, durationSeconds: Number(checked.params.CallDuration ?? call.durationSeconds ?? 0) || 0, endedAt: call.endedAt ?? now });
    return new Response(null, { status: 204 });
  }
  await repository.update(call.id, {
    ...(call.providerCallId ? {} : { providerCallId }), providerStatus, status,
    ...(status === "in_progress" && !call.answeredAt ? { answeredAt: now } : {}),
    ...(TERMINAL_PHONE_STATUSES.has(status) ? { endedAt: now, durationSeconds: Number(checked.params.CallDuration ?? 0) || 0 } : {}),
    ...(status === "failed" ? { errorCategory: "provider", errorSummary: "The provider could not complete the call." } : {}),
  });
  return new Response(null, { status: 204 });
}
