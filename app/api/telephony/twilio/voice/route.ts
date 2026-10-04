import twilio from "twilio";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupabasePhoneCallRepository } from "@/lib/telephony/repository";
import { createMediaToken, validateTwilioFormRequest } from "@/lib/telephony/security";
import { telephonyWebSocketUrl } from "@/lib/telephony/config";

export async function POST(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId") ?? "";
  const checked = await validateTwilioFormRequest(request, "/api/telephony/twilio/voice");
  if (!checked.valid || !callId) return new Response("Forbidden", { status: checked.status });
  const providerCallId = checked.params.CallSid ?? "";
  const repository = new SupabasePhoneCallRepository(createAdminClient());
  const call = await repository.get(callId).catch(() => null);
  if (!call || call.provider !== "twilio" || (call.providerCallId && call.providerCallId !== providerCallId)) return new Response("Forbidden", { status: 403 });
  if (!call.providerCallId && providerCallId) await repository.update(call.id, { providerCallId, providerStatus: checked.params.CallStatus ?? "in-progress", status: "in_progress", answeredAt: new Date().toISOString() });
  const response = new twilio.twiml.VoiceResponse();
  const stream = response.connect().stream({ url: telephonyWebSocketUrl("/api/telephony/twilio/media"), statusCallback: `${telephonyWebSocketUrl("/api/telephony/twilio/status").replace(/^wss:/i, "https:")}?callId=${encodeURIComponent(call.id)}`, statusCallbackMethod: "POST" });
  stream.parameter({ name: "callId", value: call.id });
  stream.parameter({ name: "mediaToken", value: createMediaToken(call.id) });
  return new Response(response.toString(), { headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
}
