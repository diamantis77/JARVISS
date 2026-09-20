import type { VoiceState } from "../../types";

export type VoiceEvent = "REQUEST_START" | "MIC_GRANTED" | "CONNECTED" | "USER_AUDIO" | "UTTERANCE_FINAL" | "JARVIS_AUDIO" | "BARGE_IN" | "MUTE" | "UNMUTE" | "RECONNECT" | "FAIL" | "DISCONNECT";

export interface VoiceSnapshot {
  state: VoiceState;
  muted: boolean;
  inputLevel: number;
  outputLevel: number;
  error: string | null;
}

export interface VoiceProvider {
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  mute(): void;
  unmute(): void;
  getState(): VoiceSnapshot;
}
