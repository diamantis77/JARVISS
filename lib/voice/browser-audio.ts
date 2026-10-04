"use client";

export type MicrophonePermission = "granted" | "prompt" | "denied" | "unavailable";
export type AmbientNoise = "low" | "medium" | "high" | "unknown";

export type MicrophoneReading = {
  level: number;
  peak: number;
  sampleRate: number | null;
};

export type MicrophoneCalibration = {
  backgroundLevel: number;
  voiceLevel: number;
  speechThreshold: number;
  calibratedAt: string;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function buildSupportedAudioConstraints(deviceId?: string): MediaTrackConstraints {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() ?? {};
  const constraints: MediaTrackConstraints = {};
  if (deviceId && supported.deviceId) constraints.deviceId = { exact: deviceId };
  if (supported.echoCancellation) constraints.echoCancellation = true;
  if (supported.noiseSuppression) constraints.noiseSuppression = true;
  if (supported.autoGainControl) constraints.autoGainControl = true;
  if (supported.channelCount) constraints.channelCount = { ideal: 1 };
  if (supported.sampleRate) constraints.sampleRate = { ideal: 48_000 };
  if (supported.sampleSize) constraints.sampleSize = { ideal: 16 };
  return constraints;
}

export function optimizeTrackForSpeech(track: MediaStreamTrack) {
  if (track.kind === "audio" && "contentHint" in track) track.contentHint = "speech";
}

export async function getMicrophonePermission(): Promise<MicrophonePermission> {
  if (!navigator.mediaDevices?.getUserMedia) return "unavailable";
  try {
    const result = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return result?.state ?? "prompt";
  } catch {
    return "prompt";
  }
}

export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
}

export function calculateRms(values: Uint8Array<ArrayBufferLike>) {
  if (!values.length) return 0;
  let sum = 0;
  for (const value of values) {
    const centered = (value - 128) / 128;
    sum += centered * centered;
  }
  return clamp(Math.sqrt(sum / values.length) * 4, 0, 1);
}

export function classifyAmbientNoise(level: number | null): AmbientNoise {
  if (level === null || !Number.isFinite(level)) return "unknown";
  if (level < 0.055) return "low";
  if (level < 0.14) return "medium";
  return "high";
}

export function createCalibration(backgroundSamples: number[], voiceSamples: number[], now = new Date()): MicrophoneCalibration | null {
  if (!backgroundSamples.length || !voiceSamples.length) return null;
  const average = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
  const backgroundLevel = average(backgroundSamples);
  const orderedVoice = [...voiceSamples].sort((a, b) => a - b);
  const voiceLevel = orderedVoice[Math.max(0, Math.floor(orderedVoice.length * .85) - 1)] ?? 0;
  if (voiceLevel < backgroundLevel + .025 || voiceLevel < backgroundLevel * 1.35) return null;
  return {
    backgroundLevel: Number(backgroundLevel.toFixed(4)),
    voiceLevel: Number(voiceLevel.toFixed(4)),
    speechThreshold: Number(clamp(backgroundLevel + (voiceLevel - backgroundLevel) * .32, .035, .32).toFixed(4)),
    calibratedAt: now.toISOString(),
  };
}

export class BrowserMicrophoneMeter {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private values = new Uint8Array(512);
  private ownsStream = true;

  async start(deviceId?: string, existingStream?: MediaStream) {
    if (this.stream) return this.stream;
    this.ownsStream = !existingStream;
    const stream = existingStream ?? await navigator.mediaDevices.getUserMedia({ audio: buildSupportedAudioConstraints(deviceId) });
    for (const track of stream.getAudioTracks()) optimizeTrackForSpeech(track);
    const context = new AudioContext({ latencyHint: "interactive" });
    await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = .72;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    this.stream = stream;
    this.context = context;
    this.source = source;
    this.analyser = analyser;
    return stream;
  }

  read(): MicrophoneReading {
    if (!this.analyser) return { level: 0, peak: 0, sampleRate: this.context?.sampleRate ?? null };
    this.analyser.getByteTimeDomainData(this.values);
    let peak = 0;
    for (const value of this.values) peak = Math.max(peak, Math.abs(value - 128) / 128);
    return { level: calculateRms(this.values), peak: clamp(peak * 2.5, 0, 1), sampleRate: this.context?.sampleRate ?? null };
  }

  getStream() { return this.stream; }

  detachStream() {
    const stream = this.stream;
    this.ownsStream = false;
    this.stream = null;
    return stream;
  }

  async stop(stopTracks = this.ownsStream) {
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    if (stopTracks) for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.context) await this.context.close().catch(() => undefined);
    this.context = null;
  }
}
