import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  liveInstances: [] as Array<{ emit: (event: string, ...args: unknown[]) => void; sent: Array<{ type: string; [key: string]: unknown }>; socket: { emit: (event: string, ...args: unknown[]) => void } }>,
  runJarvisLoop: vi.fn(async () => ({ run: { id: "run-id" }, message: "Είμαι εδώ και σας ακούω." })),
  failAnswerUpdate: false,
  call: {
    id: "phone-call", userId: "owner-id", provider: "vonage", providerCallId: "provider-call",
    status: "in_progress", answeredAt: "2026-09-23T00:00:00.000Z", reason: "manual test",
    context: { source: "settings_manual_test" },
  } as Record<string, unknown>,
}));

vi.mock("openai", () => ({ default: class FakeOpenAI {} }));
vi.mock("openai/resources/live/ws", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return { LiveWS: class FakeLive extends Emitter {
    socket = new Emitter();
    sent: Array<{ type: string; [key: string]: unknown }> = [];
    constructor() { super(); state.liveInstances.push(this); }
    send(event: { type: string; [key: string]: unknown }) { this.sent.push(event); }
    close(props: { code: number; reason: string }) { this.emit("close", props.code, props.reason, []); }
  } };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/repositories/supabase", () => ({ createSupabaseRepositories: () => ({ settings: { get: async () => ({ defaultLanguage: "el-GR", preferredFormOfAddress: "formal", timezone: "Europe/Athens" }) } }) }));
vi.mock("@/lib/voice/instructions", () => ({ buildVoicePresentationInstructions: () => "Speak Greek." }));
vi.mock("@/lib/ai/openai-provider-core", () => ({ OpenAIJarvisProviderCore: class {} }));
vi.mock("@/lib/research/factory", () => ({ createResearchService: () => ({}) }));
vi.mock("@/lib/jarvis/tool-loop", () => ({ runJarvisLoop: state.runJarvisLoop }));
vi.mock("../lib/telephony/provider", () => ({ createTelephonyProvider: () => ({ endCall: vi.fn(async () => undefined) }) }));
vi.mock("../lib/telephony/repository", () => ({
  SupabasePhoneCallRepository: class {
    async get() { return { ...state.call }; }
    async getSettings() { return { maxCallMinutes: 10 }; }
    async update(_id: string, patch: Record<string, unknown>) { if (state.failAnswerUpdate && patch.status === "in_progress") throw new Error("transient database write failure"); Object.assign(state.call, patch); return { ...state.call }; }
  },
}));

import { handleVonageMediaSocket } from "../lib/telephony/vonage-media-bridge";

function pcmFrame(amplitude: number) {
  const frame = Buffer.alloc(640);
  for (let index = 0; index < 320; index += 1) frame.writeInt16LE(amplitude, index * 2);
  return frame;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); state.liveInstances.length = 0; state.runJarvisLoop.mockClear(); state.failAnswerUpdate = false; state.call.context = { source: "settings_manual_test" }; });

describe("Vonage media session lifetime", () => {
  it("does not hang up an authenticated answered call for a transient audit write failure", async () => {
    state.failAnswerUpdate = true;
    const socket = new EventEmitter() as EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.readyState = WebSocket.OPEN; socket.send = vi.fn(); socket.close = vi.fn();
    handleVonageMediaSocket(socket as unknown as WebSocket, {
      provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call",
      expiresAt: Date.now() / 1000 + 300, tokenId: "test-token-id",
    });
    await vi.waitFor(() => expect(state.liveInstances).toHaveLength(1));
    const live = state.liveInstances[0];
    live.emit("session.started", { session: { id: "synthetic-live" } });
    live.emit("session.output_audio.delta", { delta: pcmFrame(1_000).toString("base64") });
    expect(socket.send.mock.calls.some((call) => Buffer.isBuffer(call[0]))).toBe(true);
    expect(socket.close).not.toHaveBeenCalled();
    socket.readyState = WebSocket.CLOSED; socket.emit("close", 1000, Buffer.alloc(0));
    live.emit("session.closed", { reason: "close_requested", usage: { seconds: 1 } });
  });

  it("keeps the call alive when the owner speaks before Live can greet", async () => {
    vi.useFakeTimers();
    const logs: Array<Record<string, unknown>> = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => { logs.push(JSON.parse(line) as Record<string, unknown>); });
    const socket = new EventEmitter() as EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.readyState = WebSocket.OPEN; socket.send = vi.fn();
    socket.close = vi.fn((code: number, reason: string) => { socket.readyState = WebSocket.CLOSED; socket.emit("close", code, Buffer.from(reason)); });
    handleVonageMediaSocket(socket as unknown as WebSocket, {
      provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call",
      expiresAt: Date.now() / 1000 + 300, tokenId: "test-token-id",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.liveInstances).toHaveLength(1);
    const live = state.liveInstances[0];
    for (let index = 0; index < 3; index += 1) socket.emit("message", pcmFrame(2_000), true);
    expect(logs.some((entry) => entry.event === "caller_first_speech_before_greeting")).toBe(true);
    live.emit("session.started", { session: { id: "synthetic-live" } });
    expect(live.sent.some((entry) => entry.type === "session.instructions.append" && String(entry.event_id).startsWith("greeting-"))).toBe(false);
    live.emit("session.input_transcript.delta", { delta: "Τι έκανες σήμερα;" });
    live.emit("session.delegation.created", { delegation: { id: "owner-first-delegation", target: "client" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.runJarvisLoop).toHaveBeenCalledOnce();
    live.emit("session.output_audio.delta", { delta: pcmFrame(1_300).toString("base64") });
    expect(socket.send.mock.calls.some((call) => Buffer.isBuffer(call[0]))).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(socket.close).not.toHaveBeenCalled();
    socket.readyState = WebSocket.CLOSED; socket.emit("close", 1000, Buffer.alloc(0));
    live.emit("session.closed", { reason: "close_requested", usage: { seconds: 5 } });
  });

  it("uses the fourth supervised greeting and waits for the caller", async () => {
    state.call.context = { source: "settings_manual_test", testCallOrdinal: 4 };
    const socket = new EventEmitter() as EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.readyState = WebSocket.OPEN; socket.send = vi.fn(); socket.close = vi.fn();
    handleVonageMediaSocket(socket as unknown as WebSocket, {
      provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call",
      expiresAt: Date.now() / 1000 + 300, tokenId: "test-token-id",
    });
    await vi.waitFor(() => expect(state.liveInstances).toHaveLength(1));
    const live = state.liveInstances[0];
    live.emit("session.started", { session: { id: "synthetic-live" } });
    expect(live.sent.some((event) => event.type === "session.instructions.append" && String(event.content).includes("Δοκιμάζουμε δύο συνεχόμενες διακοπές. Σας ακούω."))).toBe(true);
    expect(socket.close).not.toHaveBeenCalled();
    socket.readyState = WebSocket.CLOSED; socket.emit("close", 1000, Buffer.alloc(0));
    live.emit("session.closed", { reason: "close_requested", usage: { seconds: 0 } });
  });
  it("uses the third supervised greeting and honors the owner's exact test-ending phrase", async () => {
    vi.useFakeTimers();
    state.call.context = { source: "settings_manual_test", testCallOrdinal: 3 };
    const socket = new EventEmitter() as EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.readyState = WebSocket.OPEN;
    socket.send = vi.fn();
    socket.close = vi.fn((code: number, reason: string) => { socket.readyState = WebSocket.CLOSED; socket.emit("close", code, Buffer.from(reason)); });
    handleVonageMediaSocket(socket as unknown as WebSocket, {
      provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call",
      expiresAt: Date.now() / 1000 + 300, tokenId: "test-token-id",
    });
    await vi.advanceTimersByTimeAsync(0);
    const live = state.liveInstances[0];
    live.emit("session.started", { session: { id: "synthetic-live" } });
    expect(live.sent.some((event) => event.type === "session.instructions.append" && String(event.content).includes("Δοκιμάζουμε τώρα τη νέα φωνή και την άμεση διακοπή"))).toBe(true);
    live.emit("session.input_transcript.delta", { delta: "Ευχαριστώ Jarvis, τέλος δοκιμής." });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(socket.close).toHaveBeenCalledWith(1000, "owner_finished");
  });

  it("rejects an invalid configured voice before opening GPT-Live or sending audio", async () => {
    vi.stubEnv("JARVIS_LIVE_VOICE", "unsupported-voice");
    const socket = new EventEmitter() as EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.readyState = WebSocket.OPEN;
    socket.send = vi.fn();
    socket.close = vi.fn((code: number, reason: string) => { socket.readyState = WebSocket.CLOSED; socket.emit("close", code, Buffer.from(reason)); });
    handleVonageMediaSocket(socket as unknown as WebSocket, {
      provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call",
      expiresAt: Date.now() / 1000 + 300, tokenId: "test-token-id",
    });
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(1000, "start_failed"));
    expect(state.liveInstances).toHaveLength(0);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("survives greeting, five seconds of silence, caller speech, a second reply, and barge-in until hangup", async () => {
    vi.useFakeTimers();
    const logs: Array<Record<string, unknown>> = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => { logs.push(JSON.parse(line) as Record<string, unknown>); });
    const socket = new EventEmitter() as EventEmitter & { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.readyState = WebSocket.OPEN;
    socket.send = vi.fn();
    socket.close = vi.fn((code: number, reason: string) => { socket.readyState = WebSocket.CLOSED; socket.emit("close", code, Buffer.from(reason)); });
    handleVonageMediaSocket(socket as unknown as WebSocket, {
      provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call",
      expiresAt: Date.now() / 1000 + 300, tokenId: "test-token-id",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.liveInstances, JSON.stringify(logs)).toHaveLength(1);
    const live = state.liveInstances[0];
    const start = live.sent.find((event) => event.type === "session.start");
    expect(start?.session).toMatchObject({ audio: { format: { type: "audio/pcm", rate: 16000 }, output: { voice: "stone" } } });
    live.socket.emit("open");
    live.emit("session.started", { session: { id: "synthetic-live" } });
    expect(live.sent.some((event) => event.type === "session.instructions.append")).toBe(true);
    live.emit("session.instructions.appended", { client_event_id: "greeting-test" });
    live.emit("session.output_audio.delta", { delta: pcmFrame(1200).toString("base64") });
    expect(socket.send.mock.calls.some((call) => Buffer.isBuffer(call[0]))).toBe(true);

    for (let index = 0; index < 250; index += 1) socket.emit("message", pcmFrame(0), true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(socket.close).not.toHaveBeenCalled();
    expect(live.sent.some((event) => event.type === "session.close")).toBe(false);

    for (let index = 0; index < 3; index += 1) socket.emit("message", pcmFrame(2000), true);
    const inputAudio = live.sent.find((event) => event.type === "session.input_audio.append");
    expect(Buffer.from(String(inputAudio?.audio), "base64")).toHaveLength(640); // byte-exact 16 kHz PCM16
    const outputFrame = socket.send.mock.calls.find((call) => Buffer.isBuffer(call[0]))?.[0] as Buffer;
    expect(outputFrame.length).toBeGreaterThan(0);
    expect(outputFrame).toEqual(pcmFrame(1200)); // no resampling or gain
    live.emit("session.input_transcript.delta", { delta: "Τι μπορείς να κάνεις;" });
    live.emit("session.delegation.created", { delegation: { id: "delegation-1", target: "client" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.runJarvisLoop).toHaveBeenCalledOnce();
    expect(live.sent.some((event) => event.type === "session.commentary.append" && event.delegation_id === "delegation-1")).toBe(true);
    live.emit("session.output_audio.delta", { delta: pcmFrame(1100).toString("base64") });
    for (let index = 0; index < 15; index += 1) socket.emit("message", pcmFrame(0), true);
    for (let index = 0; index < 3; index += 1) socket.emit("message", pcmFrame(2000), true);
    expect(socket.send.mock.calls.some((call) => call[0] === JSON.stringify({ action: "clear" }))).toBe(true);
    expect(live.sent.some((event) => event.type === "response.cancel")).toBe(false);
    expect(socket.close).not.toHaveBeenCalled();

    // A rejected per-command Live event must not end a connected phone call.
    live.emit("error", { error: { error: { code: "unknown_parameter", type: "invalid_request_error", client_event_id: "bad-command" } } });
    expect(socket.close).not.toHaveBeenCalled();
    live.emit("response.event", { event: { type: "response.completed" } });
    expect(socket.close).not.toHaveBeenCalled();

    socket.readyState = WebSocket.CLOSED;
    socket.emit("close", 1000, Buffer.alloc(0));
    await vi.advanceTimersByTimeAsync(0);
    expect(live.sent.some((event) => event.type === "session.close")).toBe(true);
    live.emit("session.closed", { reason: "close_requested", usage: { seconds: 5 } });
    expect(logs.some((entry) => entry.event === "vonage_ws_close" && entry.receivedPackets === 271 && entry.sentPackets === 2)).toBe(true);
    expect(logs.some((entry) => entry.event === "caller_speech_started")).toBe(true);
    expect(logs.some((entry) => entry.event === "caller_barge_in")).toBe(true);
    expect(logs.some((entry) => entry.event === "openai_session_closed")).toBe(true);
    expect(live.sent.filter((event) => event.type === "session.start")).toHaveLength(1);
    expect(live.sent.some((event) => event.type === "session.update")).toBe(false);
  });

  it("clears a five-second utterance within 250 ms, discards old audio, and keeps listening", async () => {
    vi.useFakeTimers();
    const logs: Array<Record<string, unknown>> = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => { logs.push(JSON.parse(line) as Record<string, unknown>); });
    const socket = new EventEmitter() as EventEmitter & { readyState: number; bufferedAmount: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.readyState = WebSocket.OPEN; socket.bufferedAmount = 0;
    socket.send = vi.fn();
    socket.close = vi.fn((code: number, reason: string) => { socket.readyState = WebSocket.CLOSED; socket.emit("close", code, Buffer.from(reason)); });
    handleVonageMediaSocket(socket as unknown as WebSocket, {
      provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call",
      expiresAt: Date.now() / 1000 + 300, tokenId: "test-token-id",
    });
    await vi.advanceTimersByTimeAsync(0);
    const live = state.liveInstances[0];
    live.emit("session.started", { session: { id: "synthetic-live" } });
    const fiveSeconds = Buffer.alloc(16_000 * 2 * 5);
    for (let index = 0; index < fiveSeconds.length / 2; index += 1) {
      fiveSeconds.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 180 * index / 16_000) * 3_000), index * 2);
    }
    live.emit("session.output_audio.delta", { delta: fiveSeconds.toString("base64") });
    await vi.advanceTimersByTimeAsync(200);
    const actualOutput = socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0]));
    const echoFrame = Buffer.from(actualOutput.at(-1)?.[0] as Buffer);
    for (let index = 0; index < echoFrame.length / 2; index += 1) echoFrame.writeInt16LE(Math.round(echoFrame.readInt16LE(index * 2) / 2), index * 2);
    for (let index = 0; index < 3; index += 1) socket.emit("message", echoFrame, true);
    for (let index = 0; index < 3; index += 1) socket.emit("message", pcmFrame(200), true); // line noise
    socket.emit("message", pcmFrame(20_000), true); // single spike
    socket.emit("message", pcmFrame(0), true);
    expect(socket.send.mock.calls.some((call) => call[0] === JSON.stringify({ action: "clear" }))).toBe(false);

    await vi.advanceTimersByTimeAsync(1_300); // caller starts 1.5 s into JARVIS's 5 s speech
    for (let index = 0; index < 3; index += 1) {
      socket.emit("message", pcmFrame(2_000), true);
      if (index < 2) await vi.advanceTimersByTimeAsync(20);
    }
    const interruption = logs.find((entry) => entry.event === "caller_barge_in");
    expect(interruption).toBeDefined();
    expect(interruption?.interruption_latency_ms).toBeLessThan(250);
    expect(interruption?.discardedLocalBytes).toBeGreaterThan(0);
    expect(interruption?.provider_playback_clear_sent_at).toBeTruthy();
    expect(interruption?.local_output_queue_cleared_at).toBeTruthy();
    expect(interruption?.last_old_assistant_audio_sent_at).toBeTruthy();
    const sentAtClear = socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0])).length;
    live.emit("session.output_audio.delta", { delta: pcmFrame(1_000).toString("base64") }); // stale output
    await vi.advanceTimersByTimeAsync(400);
    expect(socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0]))).toHaveLength(sentAtClear);
    expect(socket.close).not.toHaveBeenCalled();
    expect(live.sent.some((event) => event.type === "response.cancel")).toBe(false);

    for (let index = 0; index < 10; index += 1) socket.emit("message", pcmFrame(0), true);
    await vi.advanceTimersByTimeAsync(501);
    live.emit("session.output_audio.delta", { delta: pcmFrame(1_000).toString("base64") }); // old answer still arriving after silence
    expect(socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0]))).toHaveLength(sentAtClear);

    live.emit("session.input_transcript.delta", { delta: "Πες μου μόνο τα σημαντικότερα.", start_ms: 3_000, end_ms: 3_300 });
    live.emit("session.delegation.created", { delegation: { id: "interruption-1", target: "client" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.runJarvisLoop).toHaveBeenCalledOnce();
    const commentary = live.sent.filter((event) => event.type === "session.commentary.append").at(-1);
    live.emit("session.commentary.appended", { client_event_id: commentary?.event_id, start_ms: 3_400, end_ms: 3_400 });
    live.emit("session.output_transcript.delta", { delta: "Τα σημαντικότερα.", start_ms: 3_410, end_ms: 3_500 });
    live.emit("session.output_audio.delta", { delta: pcmFrame(1_400).toString("base64") });
    expect(socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0])).length).toBeGreaterThan(sentAtClear);
    expect(socket.close).not.toHaveBeenCalled();

    socket.readyState = WebSocket.CLOSED; socket.emit("close", 1000, Buffer.alloc(0));
    await vi.advanceTimersByTimeAsync(0);
    live.emit("session.closed", { reason: "close_requested", usage: { seconds: 6 } });
    expect(logs.some((entry) => entry.event === "vonage_ws_close" && entry.overflowDroppedBytes === 0)).toBe(true);
  });

  it("resumes two consecutive interrupted caller turns without requiring a Live delegation", async () => {
    vi.useFakeTimers();
    const logs: Array<Record<string, unknown>> = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => { logs.push(JSON.parse(line) as Record<string, unknown>); });
    const socket = new EventEmitter() as EventEmitter & { readyState: number; bufferedAmount: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.readyState = WebSocket.OPEN; socket.bufferedAmount = 0;
    socket.send = vi.fn();
    socket.close = vi.fn((code: number, reason: string) => { socket.readyState = WebSocket.CLOSED; socket.emit("close", code, Buffer.from(reason)); });
    handleVonageMediaSocket(socket as unknown as WebSocket, {
      provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call",
      expiresAt: Date.now() / 1000 + 300, tokenId: "test-token-id",
    });
    await vi.advanceTimersByTimeAsync(0);
    const live = state.liveInstances[0];
    live.emit("session.started", { session: { id: "synthetic-live" } });
    const fiveSeconds = Buffer.alloc(16_000 * 2 * 5, 1);
    live.emit("session.output_audio.delta", { delta: fiveSeconds.toString("base64") });
    await vi.advanceTimersByTimeAsync(1_500);

    const interrupt = async (command: string, responseText: string, responseAmplitude: number, boundaryMs: number) => {
      for (let index = 0; index < 3; index += 1) socket.emit("message", pcmFrame(2_000), true);
      expect(socket.send.mock.calls.some((call) => call[0] === JSON.stringify({ action: "clear" }))).toBe(true);
      const forwardedAtClear = socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0])).length;
      for (let index = 0; index < (responseAmplitude === 1_400 ? 316 : 10); index += 1) {
        live.emit("session.output_audio.delta", { delta: pcmFrame(800).toString("base64") });
      }
      expect(socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0]))).toHaveLength(forwardedAtClear);
      live.emit("session.input_transcript.delta", { delta: command, start_ms: boundaryMs - 500, end_ms: boundaryMs - 100 });
      for (let index = 0; index < 10; index += 1) socket.emit("message", pcmFrame(0), true);
      await vi.advanceTimersByTimeAsync(300);
      expect(state.runJarvisLoop).toHaveBeenCalledTimes(responseAmplitude === 1_400 ? 1 : 2);
      const commentary = live.sent.filter((event) => event.type === "session.commentary.append").at(-1);
      expect(commentary).toBeDefined();
      live.emit("session.commentary.appended", { client_event_id: commentary?.event_id, start_ms: boundaryMs, end_ms: boundaryMs });
      live.emit("session.output_audio.delta", { delta: pcmFrame(800).toString("base64") }); // old response after commit
      expect(socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0]))).toHaveLength(forwardedAtClear);
      live.emit("session.output_transcript.delta", { delta: responseText, start_ms: boundaryMs + 10, end_ms: boundaryMs + 30 });
      live.emit("session.output_audio.delta", { delta: pcmFrame(responseAmplitude).toString("base64") });
      await vi.advanceTimersByTimeAsync(20);
      const forwarded = socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0]));
      expect(forwarded.length).toBeGreaterThan(forwardedAtClear);
      expect(forwarded.at(-1)?.[0]).toEqual(pcmFrame(responseAmplitude));
    };

    await interrupt("Πες μου τι κάνεις.", "Μπορώ να σας βοηθήσω.", 1_400, 4_000);
    await interrupt("Μόνο τα σημαντικά.", "Τα σημαντικότερα είναι αυτά.", 1_600, 8_000);
    expect(state.runJarvisLoop).toHaveBeenCalledTimes(2);
    expect(live.sent.filter((event) => event.type === "session.commentary.append" && String(event.event_id).startsWith("phone-turn-"))).toHaveLength(2);
    expect(logs.filter((entry) => entry.event === "barge_in_output_resumed")).toHaveLength(2);
    expect(logs.some((entry) => entry.event === "barge_in_output_resumed" && Number(entry.old_response_delta_discarded_count) >= 316)).toBe(true);
    expect(socket.close).not.toHaveBeenCalled();
    expect(live.sent.some((event) => event.type === "response.cancel")).toBe(false);
    socket.readyState = WebSocket.CLOSED; socket.emit("close", 1000, Buffer.alloc(0));
    await vi.advanceTimersByTimeAsync(0);
    live.emit("session.closed", { reason: "close_requested", usage: { seconds: 9 } });
    expect(logs.some((entry) => entry.event === "openai_session_closed")).toBe(true);
    expect(logs.some((entry) => entry.event === "openai_ws_close" && entry.code === 1000 && entry.closeInitiator === "local")).toBe(true);
  });

  it("recovers an impossible resume state to listen-only without replaying stale audio", async () => {
    vi.useFakeTimers();
    const logs: Array<Record<string, unknown>> = [];
    vi.spyOn(console, "info").mockImplementation((line: string) => { logs.push(JSON.parse(line) as Record<string, unknown>); });
    const socket = new EventEmitter() as EventEmitter & { readyState: number; bufferedAmount: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    socket.readyState = WebSocket.OPEN; socket.bufferedAmount = 0;
    socket.send = vi.fn();
    socket.close = vi.fn((code: number, reason: string) => { socket.readyState = WebSocket.CLOSED; socket.emit("close", code, Buffer.from(reason)); });
    handleVonageMediaSocket(socket as unknown as WebSocket, {
      provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call",
      expiresAt: Date.now() / 1000 + 300, tokenId: "test-token-id",
    });
    await vi.advanceTimersByTimeAsync(0);
    const live = state.liveInstances[0];
    live.emit("session.started", { session: { id: "synthetic-live" } });
    live.emit("session.output_audio.delta", { delta: Buffer.alloc(16_000 * 2 * 5, 1).toString("base64") });
    await vi.advanceTimersByTimeAsync(1_500);
    for (let index = 0; index < 3; index += 1) socket.emit("message", pcmFrame(2_000), true);
    for (let index = 0; index < 10; index += 1) socket.emit("message", pcmFrame(0), true);
    const forwardedAtClear = socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0])).length;
    await vi.advanceTimersByTimeAsync(12_001);
    live.emit("session.output_audio.delta", { delta: pcmFrame(900).toString("base64") });
    expect(socket.send.mock.calls.filter((call) => Buffer.isBuffer(call[0]))).toHaveLength(forwardedAtClear);
    expect(logs.some((entry) => entry.event === "phone_resume_watchdog_fault")).toBe(true);
    expect(logs.some((entry) => entry.event === "phone_state_transition" && entry.cause === "resume_watchdog_listen_only")).toBe(true);
    expect(socket.close).not.toHaveBeenCalled();
    socket.readyState = WebSocket.CLOSED; socket.emit("close", 1000, Buffer.alloc(0));
    live.emit("session.closed", { reason: "close_requested", usage: { seconds: 14 } });
  });
});
