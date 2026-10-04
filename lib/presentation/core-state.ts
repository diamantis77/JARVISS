import type { JarvisState, VoiceState } from "../../types";

export type CoreVisualState = "standby" | "wake" | "listening" | "user-speaking" | "interrupted" | "thinking" | "executing" | "speaking" | "success" | "error" | "offline";

export function getCoreVisualState(appState: JarvisState, voiceState: VoiceState): CoreVisualState {
  if (voiceState === "wake_detected") return "wake";
  if (voiceState === "interrupted") return "interrupted";
  if (voiceState === "user_speaking") return "user-speaking";
  if (voiceState === "processing") return "thinking";
  if (["requesting_microphone", "connecting", "listening", "reconnecting"].includes(voiceState)) return "listening";
  if (voiceState === "jarvis_speaking") return "speaking";
  if (voiceState === "error") return "error";
  if (voiceState === "disconnected") return "offline";
  if (appState === "thinking") return "thinking";
  if (appState === "executing") return "executing";
  if (["wake_initializing", "wake_waiting"].includes(voiceState)) return "wake";
  if (appState === "success") return "success";
  if (appState === "error") return "error";
  return "standby";
}

export function getCoreAudioEnergy(visualState: CoreVisualState, inputLevel: number, outputLevel: number) {
  const clamp = (level: number) => Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const input = clamp(inputLevel);
  const output = visualState === "interrupted" ? 0 : clamp(outputLevel);
  const attentiveInput = Math.max(0, input - .035) * .8;
  return { input, output, energy: visualState === "speaking" ? output : visualState === "user-speaking" ? input : visualState === "listening" || visualState === "wake" ? attentiveInput : 0 };
}

export type CoreAudioEnergy = ReturnType<typeof getCoreAudioEnergy>;

export function smoothCoreAudioEnergy(previous: CoreAudioEnergy, target: CoreAudioEnergy, visualState: CoreVisualState): CoreAudioEnergy {
  // A barge-in must clear the previous assistant visual on the same frame.
  if (visualState === "interrupted" || visualState === "offline" || visualState === "error") return target;
  const follow = (from: number, to: number) => from + (to - from) * (to > from ? 0.58 : 0.22);
  const input = follow(previous.input, target.input);
  const output = follow(previous.output, target.output);
  return { input, output, energy: visualState === "speaking" ? output : visualState === "user-speaking" ? input : visualState === "listening" || visualState === "wake" ? Math.max(0, input - .035) * .8 : 0 };
}

export function getCoreHumanStatus(appState: JarvisState, voiceState: VoiceState) {
  if (voiceState === "wake_detected") return "Ενεργοποιούμαι.";
  if (voiceState === "wake_waiting") return "Περιμένω το «Hey Jarvis».";
  if (["requesting_microphone", "connecting", "reconnecting", "wake_initializing"].includes(voiceState)) return "Προετοιμάζω τη φωνητική σύνδεση.";
  if (["listening", "user_speaking", "interrupted"].includes(voiceState)) return "Σας ακούω.";
  if (voiceState === "jarvis_speaking") return "Σας ενημερώνω.";
  if (appState === "thinking") return "Το ελέγχω.";
  if (appState === "executing") return "Εκτελώ το ασφαλές σχέδιο.";
  if (appState === "success") return "Η εργασία ολοκληρώθηκε.";
  if (appState === "error" || voiceState === "error") return "Χρειάζομαι την προσοχή σας.";
  return "Έτοιμος όταν με χρειαστείτε.";
}

export function getOperationLabel(toolName?: string) {
  const labels: Record<string, string> = { search_web: "ΕΡΕΥΝΩ", search_leads: "ΕΡΕΥΝΩ LEADS", analyze_website: "ΑΝΑΛΥΩ WEBSITE", search_crm: "ΕΛΕΓΧΩ CRM", draft_outreach: "ΔΗΜΙΟΥΡΓΩ ΠΡΟΣΧΕΔΙΟ", list_calendar_events: "ΕΛΕΓΧΩ ΗΜΕΡΟΛΟΓΙΟ", list_email_threads: "ΕΛΕΓΧΩ EMAIL", create_task: "ΔΗΜΙΟΥΡΓΩ ΕΡΓΑΣΙΑ" };
  return toolName ? labels[toolName] ?? toolName.replaceAll("_", " ").toLocaleUpperCase("el-GR") : null;
}
