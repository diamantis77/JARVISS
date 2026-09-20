import { createHash } from "node:crypto";
import OpenAI from "openai";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { VOICE_PRESENTATION_INSTRUCTIONS } from "@/lib/voice/instructions";

const allowedVoices = new Set(["marin", "cedar", "coral", "alloy"]);

export async function POST(request: Request) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Your session has expired." }, { status: 401 });
  if (process.env.VOICE_ENABLED !== "true" || !process.env.OPENAI_API_KEY) return Response.json({ error: "Voice is unavailable. Text mode is still active." }, { status: 503 });
  const rate = checkRateLimit(`voice-session:${context.userId}`);
  if (!rate.allowed) return Response.json({ error: "Please wait before starting another voice session." }, { status: 429 });
  const body = await request.json().catch(() => null) as { sdp?: unknown } | null;
  if (typeof body?.sdp !== "string" || body.sdp.length < 20 || body.sdp.length > 100_000) return Response.json({ error: "Invalid WebRTC offer." }, { status: 400 });
  const settings = await context.repositories.settings.get();
  const voice = allowedVoices.has(settings.jarvisVoice) ? settings.jarvisVoice : "marin";
  const model = process.env.OPENAI_VOICE_MODEL || "gpt-live-1";
  const localSession = await context.repositories.voice.createSession({ providerSessionId: null, model, voice });
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });
    const safetyId = createHash("sha256").update(`jarvis:${context.userId}`).digest("hex");
    const live = await client.live.create({
      session: {
        model,
        audio: { output: { voice } },
        delegation: { type: "client" },
        instructions: VOICE_PRESENTATION_INSTRUCTIONS,
        store: false,
        client: { data_channel: {
          allowed_client_events: ["session.commentary.append", "session.thinking.append", "session.input_audio.mute", "session.input_audio.unmute", "session.close"],
          allowed_server_events: ["session.started", "session.input_transcript.delta", "session.output_transcript.delta", "session.delegation.created", "session.usage.updated", "session.closed", "error", "info"].map((type) => ({ type })),
        } },
      },
      transport: { type: "webrtc", sdp: body.sdp },
    }, { headers: { "OpenAI-Safety-Identifier": safetyId } });
    await context.repositories.voice.updateSession(localSession.id, { providerSessionId: live.session.id, status: "active" });
    await context.repositories.activity.create({ eventType: "system", title: "Voice session started", description: "Realtime voice connected.", metadata: { voiceSessionId: localSession.id } });
    return Response.json({ sessionId: localSession.id, providerSessionId: live.session.id, transport: { type: "webrtc", sdp: live.transport.sdp }, limits: { idleTimeoutMs: Number(process.env.VOICE_IDLE_TIMEOUT_MS || 120_000), maxSessionMinutes: Number(process.env.VOICE_MAX_SESSION_MINUTES || 20) } });
  } catch {
    await context.repositories.voice.updateSession(localSession.id, { status: "failed", endedAt: new Date().toISOString() });
    return Response.json({ error: "Voice session creation failed. Text mode is still active." }, { status: 502 });
  }
}
