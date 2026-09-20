"use client";
import type { VoiceProvider, VoiceSnapshot } from "./contracts";
import { nextVoiceState } from "./state-machine";

type VoiceCallbacks = {
  onState(snapshot: VoiceSnapshot): void;
  onPartialTranscript(text: string): void;
  onCommand(transcript: string, commandId: string, sessionId: string): Promise<string>;
  onFinalTurn(user: string, assistant: string): void;
};

type LiveEvent = { type?: string; event_id?: string; delta?: string; error?: { message?: string }; delegation?: { id?: string; target?: string } };

export class BrowserVoiceProvider implements VoiceProvider {
  private snapshot: VoiceSnapshot = { state: "idle", muted: false, inputLevel: 0, outputLevel: 0, error: null };
  private pc: RTCPeerConnection | null = null; private channel: RTCDataChannel | null = null; private stream: MediaStream | null = null; private audio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null; private inputAnalyser: AnalyserNode | null = null; private outputAnalyser: AnalyserNode | null = null; private animationFrame = 0;
  private inputTranscript = ""; private sessionId: string | null = null; private stopped = false; private reconnects = 0; private idleTimer: ReturnType<typeof setTimeout> | null = null; private maxTimer: ReturnType<typeof setTimeout> | null = null; private idleTimeoutMs = 120_000; private maxSessionMs = 20 * 60_000;
  private handledCommands = new Set<string>(); private quietOutputSince = 0; private reconnecting = false;
  constructor(private readonly callbacks: VoiceCallbacks) {}

  getState() { return this.snapshot; }
  private emit(event: Parameters<typeof nextVoiceState>[1], patch: Partial<VoiceSnapshot> = {}) { this.snapshot = { ...this.snapshot, ...patch, state: nextVoiceState(this.snapshot.state, event) }; this.callbacks.onState(this.snapshot); }
  private setState(state: VoiceSnapshot["state"], patch: Partial<VoiceSnapshot> = {}) { this.snapshot = { ...this.snapshot, ...patch, state }; this.callbacks.onState(this.snapshot); }
  private send(event: Record<string, unknown>) { if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event)); }
  private resetIdle() { if (this.idleTimer) clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => { if (["listening", "disconnected", "error"].includes(this.snapshot.state)) void this.stopSession(); else this.resetIdle(); }, this.idleTimeoutMs); }

  async startSession() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { this.setState("error", { error: "Voice requires a supported browser and a secure context. Text mode is still active." }); return; }
    this.stopped = false; this.emit("REQUEST_START", { error: null });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      for (const track of this.stream.getAudioTracks()) track.addEventListener("ended", () => { if (!this.stopped) void this.fail("The microphone disconnected. Text mode is still active."); }, { once: true });
      this.emit("MIC_GRANTED"); this.audioContext = new AudioContext(); await this.audioContext.resume(); await this.connect();
    } catch (error) {
      const message = error instanceof DOMException && error.name === "NotAllowedError" ? "Microphone access is blocked. Enable microphone permission for this site." : error instanceof DOMException && error.name === "NotFoundError" ? "No microphone was found." : "Voice could not start. Text mode is still active.";
      this.setState("error", { error: message }); await this.cleanup(false);
    }
  }

  private async connect() {
    if (!this.stream) throw new Error("Microphone stream unavailable");
    const pc = new RTCPeerConnection(); this.pc = pc;
    this.audio = document.createElement("audio"); this.audio.autoplay = true; this.audio.setAttribute("playsinline", "true");
    pc.ontrack = (event) => { const remote = event.streams[0] ?? new MediaStream([event.track]); if (this.audio) { this.audio.srcObject = remote; void this.audio.play().catch(() => this.fail("Audio playback was blocked. Text mode is still active.")); } this.setupOutputMeter(remote); };
    for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
    this.setupInputMeter(this.stream);
    const channel = pc.createDataChannel("oai-events"); this.channel = channel;
    channel.addEventListener("message", (event) => this.handleEvent(event.data));
    channel.addEventListener("open", () => { this.emit("CONNECTED"); this.resetIdle(); });
    channel.addEventListener("close", () => { if (!this.stopped) void this.reconnect(); });
    pc.addEventListener("connectionstatechange", () => { if (!this.stopped && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) void this.reconnect(); });
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await this.waitForIce(pc);
    const response = await fetch("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp: pc.localDescription?.sdp }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Voice connection failed");
    this.sessionId = data.sessionId; this.idleTimeoutMs = Math.max(30_000, Number(data.limits?.idleTimeoutMs ?? 120_000)); this.maxSessionMs = Math.max(60_000, Number(data.limits?.maxSessionMinutes ?? 20) * 60_000);
    await pc.setRemoteDescription({ type: "answer", sdp: data.transport.sdp });
    this.maxTimer = setTimeout(() => { if (["listening", "error", "disconnected"].includes(this.snapshot.state)) void this.stopSession(); else setTimeout(() => void this.stopSession(), 15_000); }, this.maxSessionMs);
    this.startMeters();
  }

  private waitForIce(pc: RTCPeerConnection) { if (pc.iceGatheringState === "complete") return Promise.resolve(); return new Promise<void>((resolve) => { const listener = () => { if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", listener); resolve(); } }; pc.addEventListener("icegatheringstatechange", listener); setTimeout(() => { pc.removeEventListener("icegatheringstatechange", listener); resolve(); }, 2500); }); }
  private setupInputMeter(stream: MediaStream) { this.audioContext ??= new AudioContext(); const analyser = this.audioContext.createAnalyser(); analyser.fftSize = 256; this.audioContext.createMediaStreamSource(stream).connect(analyser); this.inputAnalyser = analyser; }
  private setupOutputMeter(stream: MediaStream) { this.audioContext ??= new AudioContext(); const analyser = this.audioContext.createAnalyser(); analyser.fftSize = 256; this.audioContext.createMediaStreamSource(stream).connect(analyser); this.outputAnalyser = analyser; }
  private level(analyser: AnalyserNode | null) { if (!analyser) return 0; const values = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(values); let sum = 0; for (const value of values) { const centered = (value - 128) / 128; sum += centered * centered; } return Math.min(1, Math.sqrt(sum / values.length) * 4); }
  private startMeters() { const frame = () => { if (this.stopped) return; const inputLevel = this.snapshot.muted ? 0 : this.level(this.inputAnalyser); const outputLevel = this.level(this.outputAnalyser); this.snapshot = { ...this.snapshot, inputLevel, outputLevel }; if (inputLevel > .12) { this.resetIdle(); if (this.snapshot.state === "jarvis_speaking") { if (this.audio) this.audio.muted = true; this.emit("BARGE_IN"); } else if (this.snapshot.state === "listening") this.emit("USER_AUDIO"); } if (outputLevel > .04 && inputLevel < .12 && ["processing", "listening", "interrupted"].includes(this.snapshot.state)) { if (this.audio) this.audio.muted = false; this.quietOutputSince = 0; this.emit("JARVIS_AUDIO"); } else if (this.snapshot.state === "jarvis_speaking" && outputLevel <= .02) { this.quietOutputSince ||= performance.now(); if (performance.now() - this.quietOutputSince > 700) this.setState("listening"); } this.callbacks.onState(this.snapshot); this.animationFrame = requestAnimationFrame(frame); }; this.animationFrame = requestAnimationFrame(frame); }

  private handleEvent(raw: string) {
    let event: LiveEvent; try { event = JSON.parse(raw) as LiveEvent; } catch { return; }
    if (event.type === "session.started") this.emit("CONNECTED");
    if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") { this.inputTranscript += event.delta; if (this.snapshot.state === "interrupted" || this.snapshot.state === "processing") this.emit("USER_AUDIO"); this.callbacks.onPartialTranscript(this.inputTranscript); this.resetIdle(); }
    if (event.type === "session.delegation.created" && event.delegation?.target === "client" && event.delegation.id) void this.handleDelegation(event.delegation.id, event.event_id ?? crypto.randomUUID());
    if (event.type === "session.output_transcript.delta") this.resetIdle();
    if (event.type === "session.closed") void this.cleanup(false);
    if (event.type === "error") void this.fail(event.error?.message ?? "Voice session failed. Text mode is still active.");
  }

  private async handleDelegation(delegationId: string, commandId: string) {
    const transcript = this.inputTranscript.trim(); this.inputTranscript = ""; this.callbacks.onPartialTranscript("");
    if (!transcript || !this.sessionId || this.handledCommands.has(commandId)) return;
    this.handledCommands.add(commandId); this.emit("UTTERANCE_FINAL");
    try { const answer = await this.callbacks.onCommand(transcript, commandId, this.sessionId); this.callbacks.onFinalTurn(transcript, answer); this.send({ type: "session.commentary.append", delegation_id: delegationId, content: answer.slice(0, 2400) }); this.resetIdle(); }
    catch { const answer = /[Α-ω]/u.test(transcript) ? "Η φωνητική εντολή απέτυχε με ασφάλεια. Το text mode παραμένει διαθέσιμο." : "The voice command failed safely. Text mode remains available."; this.callbacks.onFinalTurn(transcript, answer); this.send({ type: "session.commentary.append", delegation_id: delegationId, content: answer }); this.setState("listening"); }
  }

  mute() { for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = false; this.send({ type: "session.input_audio.mute" }); this.snapshot = { ...this.snapshot, muted: true, inputLevel: 0 }; this.callbacks.onState(this.snapshot); }
  unmute() { for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = true; this.send({ type: "session.input_audio.unmute" }); this.snapshot = { ...this.snapshot, muted: false }; this.callbacks.onState(this.snapshot); }
  private async reconnect() { if (this.stopped || this.reconnecting) return; if (this.reconnects >= 1) { await this.fail("Voice disconnected. Text mode is still active."); return; } this.reconnecting = true; this.reconnects += 1; this.emit("RECONNECT"); const oldId = this.sessionId; this.sessionId = null; await this.cleanup(true); if (oldId) await fetch(`/api/voice/session/${encodeURIComponent(oldId)}/end`, { method: "POST" }).catch(() => undefined); await new Promise((resolve) => setTimeout(resolve, 1200)); if (!this.stopped) { try { await this.connect(); } catch { await this.fail("Voice reconnection failed. Text mode is still active."); } } this.reconnecting = false; }
  private async fail(message: string) { if (this.stopped) return; this.stopped = true; const id = this.sessionId; this.sessionId = null; this.setState("error", { error: message, inputLevel: 0, outputLevel: 0 }); await this.cleanup(false); if (id) await fetch(`/api/voice/session/${encodeURIComponent(id)}/end`, { method: "POST" }).catch(() => undefined); }
  async stopSession() { this.stopped = true; this.send({ type: "session.close" }); const id = this.sessionId; await new Promise((resolve) => setTimeout(resolve, 250)); await this.cleanup(false); if (id) await fetch(`/api/voice/session/${encodeURIComponent(id)}/end`, { method: "POST" }).catch(() => undefined); this.setState("disconnected", { inputLevel: 0, outputLevel: 0 }); }
  private async cleanup(preserveStream: boolean) { if (this.animationFrame) cancelAnimationFrame(this.animationFrame); if (this.idleTimer) clearTimeout(this.idleTimer); if (this.maxTimer) clearTimeout(this.maxTimer); this.channel?.close(); this.pc?.close(); this.channel = null; this.pc = null; if (!preserveStream) { for (const track of this.stream?.getTracks() ?? []) track.stop(); this.stream = null; if (this.audioContext) await this.audioContext.close().catch(() => undefined); this.audioContext = null; } if (this.audio) { this.audio.pause(); this.audio.srcObject = null; this.audio = null; } }
}
