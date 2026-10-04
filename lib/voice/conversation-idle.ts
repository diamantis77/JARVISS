import type { VoiceSnapshot } from "./contracts";

// Keep Live connected only briefly while waiting for a follow-up. The local
// wake recognizer takes over after the Live session closes.
export const INITIAL_LISTEN_MS = 30_000;
export const FOLLOW_UP_LISTEN_MS = 15_000;

export function conversationIdleDelay(state: VoiceSnapshot["state"], configuredMs: number, awaitingFollowUp: boolean) {
  if (!["listening", "user_speaking", "interrupted"].includes(state)) return configuredMs;
  return Math.min(configuredMs, awaitingFollowUp ? FOLLOW_UP_LISTEN_MS : INITIAL_LISTEN_MS);
}

export function shouldCloseIdleConversation(state: VoiceSnapshot["state"]) {
  return state === "listening" || state === "user_speaking" || state === "interrupted";
}
