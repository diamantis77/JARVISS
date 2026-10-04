import type { BuiltInVoice } from "openai/resources/live/live";

export const BROWSER_LIVE_VOICES = ["stone", "cedar"] as const satisfies readonly BuiltInVoice[];
export type BrowserLiveVoice = (typeof BROWSER_LIVE_VOICES)[number];

export function getBrowserLiveVoice(value = process.env.JARVIS_BROWSER_VOICE): BrowserLiveVoice {
  const selected = (value ?? "stone").trim().toLowerCase();
  if (!BROWSER_LIVE_VOICES.some((voice) => voice === selected)) throw new Error("Invalid JARVIS_BROWSER_VOICE configuration");
  return selected as BrowserLiveVoice;
}
