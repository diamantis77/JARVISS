import WebSocket from "ws";
import { createPhoneLiveSession } from "./phone-live-bridge";
import { validateMediaToken } from "./security";

type TwilioMessage = { event?: string; streamSid?: string; start?: { streamSid?: string; callSid?: string; customParameters?: Record<string, string> }; media?: { payload?: string } };
function mulawLevel(base64: string) { const bytes = Buffer.from(base64, "base64"); if (!bytes.length) return 0; let sum = 0; for (const byte of bytes) { const sample = ~byte & 0xff; const sign = sample & 0x80 ? -1 : 1; const exponent = (sample >> 4) & 7; const mantissa = sample & 15; const pcm = sign * ((((mantissa << 3) + 0x84) << exponent) - 0x84); sum += pcm * pcm; } return Math.sqrt(sum / bytes.length); }

export function handleTwilioMediaSocket(socket: WebSocket) {
  let streamSid = ""; let session: ReturnType<typeof createPhoneLiveSession> | null = null;
  const send = (payload: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload)); };
  socket.on("message", (raw) => { let message: TwilioMessage; try { message = JSON.parse(raw.toString()) as TwilioMessage; } catch { session?.fail("invalid_message"); return; }
    if (message.event === "start") { const parameters = message.start?.customParameters ?? {}; const phoneCallId = parameters.callId ?? ""; streamSid = message.start?.streamSid ?? message.streamSid ?? ""; if (!phoneCallId || !streamSid || !validateMediaToken(phoneCallId, parameters.mediaToken ?? "")) { socket.close(1008, "invalid_authorization"); return; } session = createPhoneLiveSession({ socket, provider: "twilio", phoneCallId, providerCallId: message.start?.callSid, liveAudioFormat: { type: "audio/pcmu", rate: 8000 }, sendAudio: (audio) => send({ event: "media", streamSid, media: { payload: audio } }), clearPlayback: () => send({ event: "clear", streamSid }), close: (reason) => { if (socket.readyState === WebSocket.OPEN) socket.close(1000, reason); } }); return; }
    if (message.event === "media" && message.media?.payload && session) session.pushAudio(message.media.payload, mulawLevel(message.media.payload)); else if (message.event === "stop") session?.stop();
  });
  socket.on("close", () => session?.stop("socket_closed")); socket.on("error", () => session?.fail("socket_error"));
}
