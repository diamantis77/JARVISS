import type { VoiceState } from "../../types";

export type WakeWordSnapshot = {
  state: Extract<VoiceState, "idle" | "wake_initializing" | "wake_waiting" | "wake_detected" | "error">;
  inputLevel: number;
  confidence: number | null;
  lastTranscript: string;
  error: string | null;
};

export type WakeSensitivity = "low" | "normal" | "high";

export type WakeWordConfig = {
  phrase: "Hey Jarvis";
  language: string;
  microphoneDeviceId?: string;
  sensitivity?: WakeSensitivity;
  speechThreshold?: number;
};

export interface WakeWordProvider {
  start(config: WakeWordConfig): Promise<void>;
  stop(): Promise<void>;
  getState(): WakeWordSnapshot;
}

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("el-GR").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export function wakeConfidenceThreshold(sensitivity: WakeSensitivity = "normal") {
  // Browser speech-recognition confidence is not calibrated consistently across
  // devices. The phrase match remains strict, so an exact two-word wake phrase can
  // safely use a lower confidence floor than ordinary dictation.
  return sensitivity === "low" ? .4 : sensitivity === "high" ? .1 : .2;
}

export function isWakeGreetingSegment(transcript: string) {
  return /^(?:hey|hay|hi|ει|εϊ|χε[ιϊ]|χ[εαι]ι)$/u.test(normalize(transcript));
}

export function matchesSplitWakePhrase(greeting: string, continuation: string, greetingConfidence = 0, continuationConfidence = 0, sensitivity: WakeSensitivity = "normal") {
  if (!isWakeGreetingSegment(greeting)) return false;
  const confidence = greetingConfidence === 0 || continuationConfidence === 0 ? 0 : Math.min(greetingConfidence, continuationConfidence);
  return matchesWakePhrase(`${greeting} ${continuation}`, confidence, sensitivity);
}

export function matchesWakePhrase(transcript: string, confidence = 0, sensitivity: WakeSensitivity = "normal") {
  const text = normalize(transcript);
  const primary = /(?:^|\s)(?:hey|hay|hi|ει|εϊ|χε[ιϊ]|χ[εαι]ι)\s+(?:jarvis|jervis|τζαρβις)(?:$|\s)/u.test(text);
  if (primary) return confidence === 0 || confidence >= wakeConfidenceThreshold(sensitivity);
  // Common on-device English substitutions are accepted only with high confidence
  // and only when preceded by the wake greeting, avoiding ordinary name mentions.
  const phonetic = /(?:^|\s)(?:hey|hay)\s+(?:charvis|jarvus|travis|service)(?:$|\s)/u.test(text);
  if (phonetic) return confidence >= .72;
  const bare = /^(?:jarvis|τζαρβις)$/u.test(text);
  const bareThreshold = sensitivity === "high" ? .86 : sensitivity === "low" ? .96 : .92;
  return bare && confidence >= bareThreshold;
}

export function extractWakeCommand(transcript: string) {
  const match = transcript.match(/(?:^|\s)(?:hey|χ[εέ][ιίϊ]|χ[εέαιά]ι)\s+(?:jarvis|τζ[άα]ρβις)[\s,.:;!?-]*(.*)$/iu);
  return match?.[1]?.trim() ?? "";
}

export function isExplicitConversationEnd(transcript: string) {
  const text = normalize(transcript);
  return /^(?:τελος συνομιλιας|τερματισε τη συνομιλια|σταματα τη συνομιλια|αυτο ηταν|μπορεις να κλεισεις|κλεισε τη συνομιλια|ευχαριστω (?:τζαρβις|jarvis)(?: αυτο ηταν)?|end conversation|stop listening|that is all|you can close|thanks jarvis(?: that is all)?)$/u.test(text);
}

type GreetingInput = { now: Date; timezone: string; formOfAddress: string; lastGreetingKey?: string | null };

export function buildActivationGreeting({ now, timezone, formOfAddress, lastGreetingKey }: GreetingInput) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(value("hour"));
  const period = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : hour >= 18 && hour < 23 ? "evening" : "late";
  const greetingKey = `${value("year")}-${value("month")}-${value("day")}:${period}`;
  const address = formOfAddress.trim() || "κύριε";
  if (lastGreetingKey === greetingKey) return { text: `Σας ακούω, ${address}.`, greetingKey, usedFullGreeting: false };
  const salutation = period === "morning" ? "Καλημέρα" : period === "afternoon" ? "Καλό απόγευμα" : period === "evening" ? "Καλησπέρα" : "Είμαι εδώ";
  return { text: `${salutation} ${address}. Σας ακούω.`, greetingKey, usedFullGreeting: true };
}

export function activationTone(context: AudioContext) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine"; oscillator.frequency.setValueAtTime(640, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.11);
  gain.gain.setValueAtTime(0.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.055, context.currentTime + 0.015); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.14);
  oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.15);
}
