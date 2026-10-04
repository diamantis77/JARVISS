import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import type { VonageMediaClaims } from "./vonage-auth";
import { pcm16Level } from "./audio";
import { logPhoneDiagnostic, safeDiagnosticCode } from "./diagnostics";
import { inspectPcm16Le, PacedPcmOutput, PcmEchoGuard } from "./phone-pcm";
import { createPhoneLiveSession } from "./phone-live-bridge";

export function handleVonageMediaSocket(socket: WebSocket, claims: VonageMediaClaims) {
  const connectionId = randomUUID();
  const openedAt = Date.now();
  const details = { connectionId, phoneCallId: claims.phoneCallId, providerCallId: claims.providerCallId ?? null };
  let receivedPackets = 0; let receivedBytes = 0; let inboundClippedSamples = 0; let outboundClippedSamples = 0;
  let packetGapsOver60Ms = 0; let lastInboundAt = 0; let maxSocketBufferedBytes = 0;
  let localCloseReason: string | null = null; let inboundRemainder = Buffer.alloc(0);
  const echoGuard = new PcmEchoGuard();
  const output = new PacedPcmOutput((frame) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(frame, { binary: true });
    echoGuard.rememberSent(frame);
    outboundClippedSamples += inspectPcm16Le(frame).clippedSamples;
    maxSocketBufferedBytes = Math.max(maxSocketBufferedBytes, socket.bufferedAmount ?? 0);
    if (output.stats.sentPackets === 0) logPhoneDiagnostic("vonage_first_audio_sent", { ...details, bytes: frame.length });
  });
  logPhoneDiagnostic("vonage_ws_open", { ...details, authenticated: true });

  const session = createPhoneLiveSession({
    socket, provider: "vonage", phoneCallId: claims.phoneCallId, providerCallId: claims.providerCallId, connectionId,
    liveAudioFormat: { type: "audio/pcm", rate: 16000 },
    sendAudio: (audio) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      // GPT-Live and Vonage both use mono signed PCM16LE at 16 kHz.
      output.enqueue(Buffer.from(audio, "base64"));
    },
    isPlaybackActive: () => output.hasPending(),
    clearPlayback: () => {
      const cleared = output.clear();
      let providerClearSentAt: number | null = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "clear" }));
        providerClearSentAt = Date.now();
        logPhoneDiagnostic("vonage_playback_cleared", { ...details, discardedLocalBytes: cleared.discardedBytes, socketBufferedBytes: socket.bufferedAmount ?? 0 });
      }
      return {
        localOutputQueueClearedAt: cleared.clearedAt, providerClearSentAt,
        lastOldAssistantAudioSentAt: cleared.lastSentAt, discardedLocalBytes: cleared.discardedBytes,
      };
    },
    close: (reason) => {
      output.close(); localCloseReason = safeDiagnosticCode(reason);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, reason);
    },
  });

  socket.on("message", (raw: RawData, isBinary: boolean) => {
    if (!isBinary) {
      try {
        const event = JSON.parse(raw.toString()) as { event?: unknown; [key: string]: unknown };
        const controlEvent = event.event === "websocket:connected" || event.event === "websocket:cleared" || event.event === "websocket:notify"
          ? event.event : "unknown";
        logPhoneDiagnostic("vonage_control", { ...details, controlEvent });
        if (event.event === "websocket:connected" && event["content-type"] !== "audio/l16;rate=16000") session.fail("audio_format_mismatch");
      } catch { logPhoneDiagnostic("vonage_control_invalid", details); }
      return;
    }
    const frame = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const now = Date.now();
    if (lastInboundAt && now - lastInboundAt > 60) packetGapsOver60Ms += 1;
    lastInboundAt = now; receivedPackets += 1; receivedBytes += frame.length;
    if (receivedPackets === 1) logPhoneDiagnostic("vonage_first_audio_received", { ...details, caller_first_audio_at: new Date(now).toISOString(), bytes: frame.length });
    // Preserve a trailing half-sample across packet boundaries; never reinterpret endianness.
    const combined = inboundRemainder.length ? Buffer.concat([inboundRemainder, frame]) : frame;
    inboundRemainder = combined.length % 2 ? Buffer.from(combined.subarray(combined.length - 1)) : Buffer.alloc(0);
    const pcm = combined.subarray(0, combined.length - inboundRemainder.length);
    if (pcm.length) {
      inboundClippedSamples += inspectPcm16Le(pcm).clippedSamples;
      const likelyEcho = output.hasPending() && echoGuard.isLikelyEcho(pcm);
      session.pushAudio(pcm.toString("base64"), pcm16Level(pcm), { echoLikely: likelyEcho, frameDurationMs: pcm.length / 32 });
    }
  });
  socket.on("close", (code, reason) => {
    output.close();
    logPhoneDiagnostic("vonage_ws_close", {
      ...details, code, reason: localCloseReason ?? (reason.length ? "remote_reason" : "none"),
      initiatedBy: localCloseReason ? "application" : "remote_or_network",
      lifetimeMs: Date.now() - openedAt, receivedPackets, receivedBytes,
      sentPackets: output.stats.sentPackets, sentBytes: output.stats.sentBytes,
      queuedBytesPeak: output.stats.maxQueuedBytes, overflowDroppedBytes: output.stats.droppedBytes,
      maxSocketBufferedBytes, packetGapsOver60Ms, inboundClippedSamples, outboundClippedSamples,
      trailingPcmBytes: inboundRemainder.length,
    });
    session.stop("socket_closed");
  });
  socket.on("error", () => {
    logPhoneDiagnostic("vonage_ws_error", { ...details, lifetimeMs: Date.now() - openedAt });
    session.fail("socket_error");
  });
}
