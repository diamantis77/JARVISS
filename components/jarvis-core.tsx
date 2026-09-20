"use client";
import type { CSSProperties } from "react";
import type { JarvisState, VoiceState } from "@/types";

const appCopy: Record<JarvisState, [string, string]> = {
  idle: ["IDLE", "Systems ready"], listening: ["LISTENING", "Voice input active"], thinking: ["THINKING", "Creating an execution plan"], executing: ["EXECUTING", "Using constrained tools"], success: ["COMPLETE", "Run finished and memory updated"], error: ["ATTENTION", "A safe recovery is required"],
};
const voiceCopy: Record<VoiceState, [string, string]> = {
  idle: ["IDLE", "Voice ready"], requesting_microphone: ["MICROPHONE", "Waiting for browser permission"], connecting: ["CONNECTING", "Establishing encrypted WebRTC"], listening: ["LISTENING", "Speak naturally in Greek or English"], user_speaking: ["HEARING YOU", "Capturing the current utterance"], processing: ["PROCESSING", "Running through the JARVIS core"], jarvis_speaking: ["SPEAKING", "Interrupt at any time"], interrupted: ["INTERRUPTED", "Listening to your new instruction"], reconnecting: ["RECONNECTING", "Restoring the voice transport"], error: ["VOICE ATTENTION", "Text mode remains available"], disconnected: ["DISCONNECTED", "Start a new voice session when ready"],
};
export function JarvisCore({ state, voiceState = "idle", audioLevel = 0 }: { state: JarvisState; voiceState?: VoiceState; audioLevel?: number }) {
  const voiceActive = !["idle", "disconnected"].includes(voiceState); const [label, sub] = voiceActive ? voiceCopy[voiceState] : appCopy[state];
  const style = { "--audio-level": String(Math.min(1, Math.max(0, audioLevel))) } as CSSProperties;
  return <div className="core-zone panel" aria-label={`Jarvis state: ${label}`} style={style}>
    <div className={`core ${voiceActive ? voiceState : state}`}><span className="ring ring-one" /><span className="ring ring-two" /><span className="ring ring-three" /><span className="core-center" /></div>
    <div className="core-label"><div className="state">{label}</div><div className="state-sub">{sub}</div></div>
  </div>;
}
