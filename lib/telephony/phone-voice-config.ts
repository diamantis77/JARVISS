import type { BuiltInVoice } from "openai/resources/live/live";

// These are the owner-selectable masculine GPT-Live voices. Keep this setting
// server-side; the voice is immutable after session.start.
export const PHONE_LIVE_VOICES = ["stone", "vesper", "meridian", "ripple", "cinder"] as const satisfies readonly BuiltInVoice[];
export type PhoneLiveVoice = (typeof PHONE_LIVE_VOICES)[number];

export function getPhoneLiveVoice(value = process.env.JARVIS_LIVE_VOICE): PhoneLiveVoice {
  const selected = (value ?? "stone").trim().toLowerCase();
  if (!PHONE_LIVE_VOICES.some((voice) => voice === selected)) throw new Error("Invalid JARVIS_LIVE_VOICE configuration");
  return selected as PhoneLiveVoice;
}

export const PHONE_VOICE_INSTRUCTIONS = [
  "You are JARVIS. Speak Greek by default.",
  "Use a mature, calm, masculine, low-register delivery: composed, intelligent, and authoritative.",
  "Avoid a youthful, cheerful, high-pitched, or overly expressive delivery. Speak at a measured pace.",
  "Keep ordinary phone answers concise. Address the owner as κύριε naturally, not in every sentence.",
  "When the caller starts speaking while you speak, stop immediately and listen. Never compete or finish the interrupted sentence.",
].join(" ");
