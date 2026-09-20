import type { VoiceState } from "../../types";
import type { VoiceEvent } from "./contracts";

const transitions: Partial<Record<VoiceState, Partial<Record<VoiceEvent, VoiceState>>>> = {
  idle: { REQUEST_START: "requesting_microphone", FAIL: "error", DISCONNECT: "disconnected" },
  requesting_microphone: { MIC_GRANTED: "connecting", FAIL: "error", DISCONNECT: "disconnected" },
  connecting: { CONNECTED: "listening", RECONNECT: "reconnecting", FAIL: "error", DISCONNECT: "disconnected" },
  listening: { USER_AUDIO: "user_speaking", MUTE: "listening", RECONNECT: "reconnecting", FAIL: "error", DISCONNECT: "disconnected" },
  user_speaking: { UTTERANCE_FINAL: "processing", MUTE: "listening", FAIL: "error", DISCONNECT: "disconnected" },
  processing: { JARVIS_AUDIO: "jarvis_speaking", USER_AUDIO: "user_speaking", FAIL: "error", DISCONNECT: "disconnected" },
  jarvis_speaking: { BARGE_IN: "interrupted", USER_AUDIO: "interrupted", FAIL: "error", DISCONNECT: "disconnected" },
  interrupted: { USER_AUDIO: "user_speaking", UTTERANCE_FINAL: "processing", FAIL: "error", DISCONNECT: "disconnected" },
  reconnecting: { CONNECTED: "listening", FAIL: "error", DISCONNECT: "disconnected" },
  error: { REQUEST_START: "requesting_microphone", DISCONNECT: "disconnected" },
  disconnected: { REQUEST_START: "requesting_microphone" },
};

export function nextVoiceState(state: VoiceState, event: VoiceEvent) {
  if (event === "UNMUTE" && state === "listening") return "listening";
  return transitions[state]?.[event] ?? state;
}

export function isExplicitVoiceApprovalSafe(pendingApprovalIds: string[], boundApprovalId: string | null, transcript: string) {
  const affirmative = /^(yes|yes,? send it|approve|confirm|ναι|ναι,? στείλ['’]? το|εγκρίνω|επιβεβαιώνω)[.!\s]*$/iu.test(transcript.trim());
  return affirmative && pendingApprovalIds.length === 1 && Boolean(boundApprovalId) && pendingApprovalIds[0] === boundApprovalId;
}
