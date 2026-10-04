"use client";
import type { VoiceProvider, VoiceSnapshot } from "./contracts";
import { nextVoiceState } from "./state-machine";
import { isExplicitConversationEnd } from "./wake-word";
import { buildSupportedAudioConstraints, optimizeTrackForSpeech } from "./browser-audio";
import { conversationIdleDelay, shouldCloseIdleConversation } from "./conversation-idle";
import { appendVoiceHistory, type VoiceHistoryMessage } from "./conversation-history";

type EndReason = "explicit" | "idle" | "maximum" | "manual" | "tap" | "background_work" | "failure";
type VoiceCallbacks = {
  onState(snapshot: VoiceSnapshot): void;
  onPartialTranscript(text: string): void;
  onCommand(transcript: string, commandId: string, sessionId: string): Promise<string>;
  onFinalTurn(user: string, assistant: string): void;
  onHistoryUpdate?(history: VoiceHistoryMessage[]): void;
  onConversationEnded(reason: EndReason): void;
};
type VoiceOptions = { initialCommentary?: string; initialCommand?: string; initialHistory?: VoiceHistoryMessage[]; microphoneDeviceId?: string; initialStream?: MediaStream | null; speechThreshold?: number };
type LiveEvent = { type?: string; delta?: string; start_ms?: number; end_ms?: number; offset_ms?: number; error?: { message?: string }; delegation?: { id?: string; target?: string } };
type TranscriptFragment = { text: string; startMs: number | null; endMs: number | null };
type PendingDelegation = { delegationId: string; commandId: string; offsetMs: number | null; timer: ReturnType<typeof setTimeout> | null };

export class BrowserVoiceProvider implements VoiceProvider {
  private snapshot: VoiceSnapshot = { state: "idle", muted: false, inputLevel: 0, outputLevel: 0, error: null };
  private pc: RTCPeerConnection | null = null; private channel: RTCDataChannel | null = null; private stream: MediaStream | null = null; private audio: HTMLAudioElement | null = null;
  private audioContext: AudioContext | null = null; private inputSource: MediaStreamAudioSourceNode | null = null; private outputSource: MediaStreamAudioSourceNode | null = null; private inputAnalyser: AnalyserNode | null = null; private outputAnalyser: AnalyserNode | null = null; private outputSink: GainNode | null = null; private animationFrame = 0;
  private inputTranscript = ""; private sessionId: string | null = null; private stopped = true; private reconnects = 0; private reconnecting = false; private generation = 0; private startPromise: Promise<void> | null = null; private endedCallbackSent = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null; private maxTimer: ReturnType<typeof setTimeout> | null = null; private endTimer: ReturnType<typeof setTimeout> | null = null; private idleTimeoutMs = 120_000; private maxSessionMs = 20 * 60_000; private sessionStartedAt = 0;
  private handledCommands = new Set<string>(); private quietOutputSince = 0; private loudInputSince = 0; private initialCommentarySent = false; private initialCommandSent = false; private endAfterSpeech = false; private awaitingFollowUp = false;
  private inputFragments: TranscriptFragment[] = []; private pendingDelegation: PendingDelegation | null = null;
  private activeCommands = 0; private conversationHistory: VoiceHistoryMessage[] = [];

  constructor(private readonly callbacks: VoiceCallbacks, private readonly options: VoiceOptions = {}) {}
  getState() { return this.snapshot; }
  private emit(event: Parameters<typeof nextVoiceState>[1], patch: Partial<VoiceSnapshot> = {}) { this.snapshot = { ...this.snapshot, ...patch, state: nextVoiceState(this.snapshot.state, event) }; this.callbacks.onState(this.snapshot); }
  private setState(state: VoiceSnapshot["state"], patch: Partial<VoiceSnapshot> = {}) { this.snapshot = { ...this.snapshot, ...patch, state }; this.callbacks.onState(this.snapshot); }
  private send(event: Record<string, unknown>) { if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event)); }
  private resetIdle() { if (this.idleTimer) clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => { if (this.activeCommands > 0) this.resetIdle(); else if (shouldCloseIdleConversation(this.snapshot.state)) void this.stopSession("idle"); else if (!["disconnected", "error"].includes(this.snapshot.state)) this.resetIdle(); }, conversationIdleDelay(this.snapshot.state, this.idleTimeoutMs, this.awaitingFollowUp)); }
  private remember(role: VoiceHistoryMessage["role"], delta: string) { this.conversationHistory = appendVoiceHistory(this.conversationHistory, role, delta); this.callbacks.onHistoryUpdate?.(this.conversationHistory); }
  private notifyEnded(reason: EndReason) { if (!this.endedCallbackSent) { this.endedCallbackSent = true; this.callbacks.onConversationEnded(reason); } }

  startSession() {
    if (this.startPromise) return this.startPromise;
    if (!this.stopped && (this.stream || this.pc)) return Promise.resolve();
    this.startPromise = this.startSessionInternal().finally(() => { this.startPromise = null; });
    return this.startPromise;
  }
  private async startSessionInternal() {
    this.stopped = false; this.endedCallbackSent = false; this.reconnects = 0; this.reconnecting = false; this.initialCommentarySent = false; this.initialCommandSent = false; this.endAfterSpeech = false; this.awaitingFollowUp = false; this.activeCommands = 0; this.conversationHistory = [...(this.options.initialHistory ?? [])]; this.handledCommands.clear(); this.inputTranscript = ""; this.inputFragments = []; this.pendingDelegation = null; this.sessionStartedAt = Date.now();
    const generation = ++this.generation;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) { await this.fail("Voice requires a supported browser and a secure context. Text mode is still active."); return; }
    this.emit("REQUEST_START", { error: null, inputLevel: 0, outputLevel: 0 });
    try {
      const inherited = this.options.initialStream;
      const stream = inherited?.getAudioTracks().some((track) => track.readyState === "live") ? inherited : await navigator.mediaDevices.getUserMedia({ audio: buildSupportedAudioConstraints(this.options.microphoneDeviceId) });
      if (this.stopped || generation !== this.generation) { for (const track of stream.getTracks()) track.stop(); return; }
      this.stream = stream; for (const track of stream.getAudioTracks()) { optimizeTrackForSpeech(track); track.addEventListener("ended", this.handleTrackEnded, { once: true }); }
      this.emit("MIC_GRANTED"); this.audioContext = new AudioContext(); await this.audioContext.resume(); await this.connect(generation);
    } catch (error) {
      if (this.stopped || generation !== this.generation) return;
      const message = error instanceof DOMException && error.name === "NotAllowedError" ? "Microphone access is blocked. Enable microphone permission for this site." : error instanceof DOMException && error.name === "NotFoundError" ? "No microphone was found." : error instanceof Error && error.message ? error.message : "Voice could not start. Text mode is still active.";
      await this.fail(message);
    }
  }
  private handleTrackEnded = () => { if (!this.stopped) void this.fail("The microphone disconnected. Text mode is still active."); };

  private async connect(generation: number) {
    if (!this.stream || this.stopped || generation !== this.generation) throw new Error("Microphone stream unavailable");
    const pc = new RTCPeerConnection(); this.pc = pc; const audio = document.createElement("audio"); audio.autoplay = true; audio.setAttribute("playsinline", "true"); this.audio = audio;
    pc.ontrack = (event) => { if (this.stopped || generation !== this.generation) return; const remote = event.streams[0] ?? new MediaStream([event.track]); if (this.audio) { this.audio.srcObject = remote; void this.audio.play().catch(() => this.fail("Audio playback was blocked. Text mode is still active.")); } this.setupOutputMeter(remote); };
    for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream); this.setupInputMeter(this.stream);
    const channel = pc.createDataChannel("oai-events"); this.channel = channel;
    channel.onmessage = (event) => this.handleEvent(event.data);
    channel.onopen = () => { if (!this.stopped && generation === this.generation) { this.emit("CONNECTED"); this.resetIdle(); } };
    channel.onclose = () => { if (!this.stopped && generation === this.generation) void this.reconnect(); };
    pc.onconnectionstatechange = () => { if (!this.stopped && generation === this.generation && (pc.connectionState === "failed" || pc.connectionState === "disconnected")) void this.reconnect(); };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer); await this.waitForIce(pc); if (this.stopped || generation !== this.generation) return;
    const response = await fetch("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp: pc.localDescription?.sdp, history: this.conversationHistory }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Voice connection failed");
    if (this.stopped || generation !== this.generation) { if (data.sessionId) void fetch(`/api/voice/session/${encodeURIComponent(data.sessionId)}/end`, { method: "POST" }).catch(() => undefined); return; }
    this.sessionId = data.sessionId; this.idleTimeoutMs = Math.max(30_000, Number(data.limits?.conversationIdleTimeoutMs ?? data.limits?.idleTimeoutMs ?? 120_000)); this.maxSessionMs = Math.max(60_000, Number(data.limits?.maxSessionMinutes ?? 20) * 60_000);
    await pc.setRemoteDescription({ type: "answer", sdp: data.transport.sdp }); this.scheduleMaximum(); this.startMeters();
  }
  private scheduleMaximum() { if (this.maxTimer) clearTimeout(this.maxTimer); const remaining = Math.max(0, this.maxSessionMs - (Date.now() - this.sessionStartedAt)); this.maxTimer = setTimeout(() => { if (["listening", "error", "disconnected"].includes(this.snapshot.state)) void this.stopSession("maximum"); else this.endTimer = setTimeout(() => void this.stopSession("maximum"), 15_000); }, remaining); }
  private waitForIce(pc: RTCPeerConnection) { if (pc.iceGatheringState === "complete") return Promise.resolve(); return new Promise<void>((resolve) => { let timer: ReturnType<typeof setTimeout>; const finish = () => { clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", listener); resolve(); }; const listener = () => { if (pc.iceGatheringState === "complete") finish(); }; timer = setTimeout(finish, 2500); pc.addEventListener("icegatheringstatechange", listener); }); }
  private setupInputMeter(stream: MediaStream) { this.disconnectInputMeter(); this.audioContext ??= new AudioContext(); const analyser = this.audioContext.createAnalyser(); analyser.fftSize = 256; this.inputSource = this.audioContext.createMediaStreamSource(stream); this.inputSource.connect(analyser); this.inputAnalyser = analyser; }
  private setupOutputMeter(stream: MediaStream) { this.disconnectOutputMeter(); this.audioContext ??= new AudioContext(); const analyser = this.audioContext.createAnalyser(); analyser.fftSize = 256; const sink = this.audioContext.createGain(); sink.gain.value = 0; this.outputSource = this.audioContext.createMediaStreamSource(stream); this.outputSource.connect(analyser); analyser.connect(sink); sink.connect(this.audioContext.destination); this.outputAnalyser = analyser; this.outputSink = sink; }
  private disconnectInputMeter() { this.inputSource?.disconnect(); this.inputAnalyser?.disconnect(); this.inputSource = null; this.inputAnalyser = null; }
  private disconnectOutputMeter() { this.outputSource?.disconnect(); this.outputAnalyser?.disconnect(); this.outputSink?.disconnect(); this.outputSource = null; this.outputAnalyser = null; this.outputSink = null; }
  private level(analyser: AnalyserNode | null) { if (!analyser) return 0; const values = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(values); let sum = 0; for (const value of values) { const centered = (value - 128) / 128; sum += centered * centered; } return Math.min(1, Math.sqrt(sum / values.length) * 4); }
  private interruptPlayback() { if (this.audio) this.audio.muted = true; }
  private resumePlayback() { if (this.audio) { this.audio.muted = false; void this.audio.play().catch(() => undefined); } }
  private startMeters() {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    const speechThreshold = Math.min(.28, Math.max(.05, this.options.speechThreshold ?? .11));
    const frame = () => {
      if (this.stopped) return;
      const inputLevel = this.snapshot.muted || document.hidden ? 0 : this.level(this.inputAnalyser); const outputLevel = document.hidden ? 0 : this.level(this.outputAnalyser); const now = performance.now(); this.snapshot = { ...this.snapshot, inputLevel, outputLevel };
      if (inputLevel > speechThreshold) { this.loudInputSince ||= now; if (now - this.loudInputSince >= 90) { this.resetIdle(); if (this.snapshot.state === "jarvis_speaking") { this.interruptPlayback(); this.emit("BARGE_IN"); } else if (["listening", "interrupted"].includes(this.snapshot.state)) this.emit("USER_AUDIO"); } } else this.loudInputSince = 0;
      if (outputLevel > .04 && inputLevel < speechThreshold && ["processing", "listening", "interrupted"].includes(this.snapshot.state)) { this.quietOutputSince = 0; this.awaitingFollowUp = false; this.resumePlayback(); this.emit("JARVIS_AUDIO"); this.resetIdle(); }
      else if (this.snapshot.state === "jarvis_speaking" && outputLevel <= .02) { this.quietOutputSince ||= now; if (now - this.quietOutputSince > 700) { if (this.endAfterSpeech) void this.stopSession("explicit"); else { this.awaitingFollowUp = true; this.setState("listening"); this.resetIdle(); } } }
      this.callbacks.onState(this.snapshot); this.animationFrame = requestAnimationFrame(frame);
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  private handleEvent(raw: string) {
    if (this.stopped) return; let event: LiveEvent; try { event = JSON.parse(raw) as LiveEvent; } catch { return; }
    if (event.type === "session.started") {
      this.emit("CONNECTED"); this.resetIdle();
      if (this.options.initialCommentary && !this.initialCommentarySent) { this.initialCommentarySent = true; this.send({ type: "session.commentary.append", delegation_id: null, content: this.options.initialCommentary.slice(0, 1200) }); }
      if (this.options.initialCommand && !this.initialCommandSent) { this.initialCommandSent = true; void this.handleCapturedCommand(this.options.initialCommand); }
    }
    if (event.type === "session.input_transcript.delta" && typeof event.delta === "string") {
      if (this.snapshot.error) this.snapshot = { ...this.snapshot, error: null };
      this.remember("user", event.delta);
      this.inputFragments.push({ text: event.delta, startMs: typeof event.start_ms === "number" ? event.start_ms : null, endMs: typeof event.end_ms === "number" ? event.end_ms : null });
      this.inputTranscript = this.inputFragments.map((fragment) => fragment.text).join("");
      if (this.pendingDelegation) this.schedulePendingDelegation(220);
      if (this.snapshot.state === "jarvis_speaking") { this.interruptPlayback(); this.emit("BARGE_IN"); }
      if (["interrupted", "processing"].includes(this.snapshot.state)) this.emit("USER_AUDIO");
      this.callbacks.onPartialTranscript(this.inputTranscript); this.resetIdle();
    }
    if (event.type === "session.delegation.created" && event.delegation?.target === "client" && event.delegation.id) this.queueDelegation(event.delegation.id, event.delegation.id, event.offset_ms);
    if (event.type === "session.output_transcript.delta") { if (this.snapshot.error) this.snapshot = { ...this.snapshot, error: null }; if (typeof event.delta === "string") this.remember("assistant", event.delta); this.resetIdle(); }
    if (event.type === "session.closed") void this.finishRemoteClose();
    if (event.type === "error") {
      // Live can reject an individual command or interrupt output without ending
      // the session. A terminal close is reported separately via session.closed.
      this.snapshot = { ...this.snapshot, error: "Η φωνητική απάντηση διακόπηκε. Μπορείτε να συνεχίσετε τη συζήτηση." };
      this.callbacks.onState(this.snapshot);
      this.resetIdle();
    }
  }
  private queueDelegation(delegationId: string, commandId: string, offsetMs?: number) {
    if (this.handledCommands.has(commandId)) return;
    if (this.pendingDelegation?.commandId === commandId) return;
    if (this.pendingDelegation) {
      if (this.pendingDelegation.timer) clearTimeout(this.pendingDelegation.timer);
      void this.handleDelegation(this.pendingDelegation.delegationId, this.pendingDelegation.commandId, this.pendingDelegation.offsetMs);
    }
    this.pendingDelegation = { delegationId, commandId, offsetMs: typeof offsetMs === "number" ? offsetMs : null, timer: null };
    this.schedulePendingDelegation(320);
  }
  private schedulePendingDelegation(delayMs: number) {
    const pending = this.pendingDelegation;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      if (this.pendingDelegation !== pending) return;
      this.pendingDelegation = null;
      void this.handleDelegation(pending.delegationId, pending.commandId, pending.offsetMs);
    }, delayMs);
  }
  private async handleCapturedCommand(transcript: string) {
    if (!this.sessionId || this.stopped) return;
    const commandId = `wake-${crypto.randomUUID()}`;
    this.awaitingFollowUp = false; this.emit("UTTERANCE_FINAL"); this.resetIdle();
    this.activeCommands += 1;
    try {
      const answer = await this.callbacks.onCommand(transcript, commandId, this.sessionId);
      if (this.stopped) return;
      this.callbacks.onFinalTurn(transcript, answer);
      this.send({ type: "session.commentary.append", delegation_id: null, content: answer.slice(0, 2400) });
      this.resetIdle();
    } catch {
      if (!this.stopped) this.setState("listening");
    } finally { this.activeCommands -= 1; if (!this.stopped) this.resetIdle(); }
  }
  private async handleDelegation(delegationId: string, commandId: string, offsetMs: number | null) {
    const cutoff = offsetMs === null ? Number.POSITIVE_INFINITY : offsetMs + 250;
    const selected = this.inputFragments.filter((fragment) => fragment.endMs === null || fragment.endMs <= cutoff);
    const remaining = this.inputFragments.filter((fragment) => fragment.endMs !== null && fragment.endMs > cutoff);
    const transcript = selected.map((fragment) => fragment.text).join("").trim();
    this.inputFragments = remaining; this.inputTranscript = remaining.map((fragment) => fragment.text).join(""); this.callbacks.onPartialTranscript(this.inputTranscript);
    if (!this.sessionId || this.handledCommands.has(commandId) || this.stopped) return;
    this.handledCommands.add(commandId); if (this.handledCommands.size > 100) this.handledCommands.delete(this.handledCommands.values().next().value!); this.awaitingFollowUp = false; this.emit("UTTERANCE_FINAL"); this.resetIdle();
    if (!transcript) { const answer = "Δεν σας άκουσα καθαρά. Παρακαλώ επαναλάβετε λίγο πιο κοντά στο μικρόφωνο."; this.callbacks.onFinalTurn("", answer); this.send({ type: "session.commentary.append", delegation_id: delegationId, content: answer }); this.setState("listening"); return; }
    if (isExplicitConversationEnd(transcript)) { const answer = "Βεβαίως. Επιστρέφω σε αναμονή για το Hey Jarvis."; this.callbacks.onFinalTurn(transcript, answer); this.endAfterSpeech = true; this.send({ type: "session.commentary.append", delegation_id: delegationId, content: answer }); this.endTimer = setTimeout(() => { if (!this.stopped && this.endAfterSpeech) void this.stopSession("explicit"); }, 5000); return; }
    this.activeCommands += 1;
    try { const answer = await this.callbacks.onCommand(transcript, commandId, this.sessionId); if (this.stopped) return; this.callbacks.onFinalTurn(transcript, answer); this.send({ type: "session.commentary.append", delegation_id: delegationId, content: answer.slice(0, 2400) }); this.resetIdle(); }
    catch { if (this.stopped) return; const answer = /[Α-ω]/u.test(transcript) ? "Η φωνητική εντολή απέτυχε με ασφάλεια. Το text mode παραμένει διαθέσιμο." : "The voice command failed safely. Text mode remains available."; this.callbacks.onFinalTurn(transcript, answer); this.send({ type: "session.commentary.append", delegation_id: delegationId, content: answer }); this.setState("listening"); }
    finally { this.activeCommands -= 1; if (!this.stopped) this.resetIdle(); }
  }

  mute() { for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = false; this.send({ type: "session.input_audio.mute" }); this.snapshot = { ...this.snapshot, muted: true, inputLevel: 0 }; this.callbacks.onState(this.snapshot); }
  unmute() { for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = true; this.send({ type: "session.input_audio.unmute" }); this.snapshot = { ...this.snapshot, muted: false }; this.callbacks.onState(this.snapshot); }
  private async reconnect() { if (this.stopped || this.reconnecting) return; if (this.reconnects >= 1) { await this.fail("Voice disconnected. Text mode is still active."); return; } this.reconnecting = true; this.reconnects += 1; this.emit("RECONNECT"); const oldId = this.sessionId; this.sessionId = null; await this.cleanup(true); if (oldId) await fetch(`/api/voice/session/${encodeURIComponent(oldId)}/end`, { method: "POST" }).catch(() => undefined); await new Promise((resolve) => setTimeout(resolve, 1200)); if (!this.stopped) { try { await this.connect(this.generation); } catch { await this.fail("Voice reconnection failed. Text mode is still active."); } } this.reconnecting = false; }
  private async finishRemoteClose() { if (this.stopped) return; this.stopped = true; this.generation += 1; const id = this.sessionId; this.sessionId = null; await this.cleanup(false); if (id) await fetch(`/api/voice/session/${encodeURIComponent(id)}/end`, { method: "POST" }).catch(() => undefined); this.setState("disconnected", { inputLevel: 0, outputLevel: 0 }); this.notifyEnded(this.endAfterSpeech ? "explicit" : "failure"); }
  private async fail(message: string) { if (this.stopped) return; this.stopped = true; this.generation += 1; const id = this.sessionId; this.sessionId = null; this.setState("error", { error: message, inputLevel: 0, outputLevel: 0 }); await this.cleanup(false); if (id) await fetch(`/api/voice/session/${encodeURIComponent(id)}/end`, { method: "POST" }).catch(() => undefined); this.notifyEnded("failure"); }
  async stopSession(reason: EndReason = "manual") { if (this.stopped) return; this.stopped = true; this.generation += 1; this.send({ type: "session.close" }); const id = this.sessionId; this.sessionId = null; if (id) await new Promise((resolve) => setTimeout(resolve, 250)); await this.cleanup(false); this.setState("disconnected", { inputLevel: 0, outputLevel: 0 }); this.notifyEnded(reason); if (id) await fetch(`/api/voice/session/${encodeURIComponent(id)}/end`, { method: "POST" }).catch(() => undefined); }
  private async cleanup(preserveStream: boolean) {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame); this.animationFrame = 0; if (this.idleTimer) clearTimeout(this.idleTimer); this.idleTimer = null; if (this.maxTimer) clearTimeout(this.maxTimer); this.maxTimer = null; if (this.endTimer) clearTimeout(this.endTimer); this.endTimer = null; if (this.pendingDelegation?.timer) clearTimeout(this.pendingDelegation.timer); this.pendingDelegation = null; this.inputFragments = []; this.inputTranscript = ""; this.disconnectInputMeter(); this.disconnectOutputMeter();
    if (this.channel) { this.channel.onmessage = null; this.channel.onopen = null; this.channel.onclose = null; this.channel.close(); } if (this.pc) { this.pc.ontrack = null; this.pc.onconnectionstatechange = null; this.pc.close(); } this.channel = null; this.pc = null;
    if (!preserveStream) { for (const track of this.stream?.getTracks() ?? []) { track.removeEventListener("ended", this.handleTrackEnded); track.stop(); } this.stream = null; if (this.audioContext) await this.audioContext.close().catch(() => undefined); this.audioContext = null; }
    if (this.audio) { this.audio.pause(); this.audio.muted = true; this.audio.srcObject = null; this.audio.remove(); this.audio = null; } this.quietOutputSince = 0; this.loudInputSince = 0;
  }
}
