export type ExperienceMode = "standby" | "activating" | "active" | "collapsing";

export type ExperienceEvent = "ACTIVATE" | "VOICE_READY" | "REQUEST_STANDBY" | "ANIMATION_COMPLETE" | "FAILURE";

const transitions: Record<ExperienceMode, Partial<Record<ExperienceEvent, ExperienceMode>>> = {
  standby: { ACTIVATE: "activating" },
  activating: { VOICE_READY: "active", REQUEST_STANDBY: "collapsing", FAILURE: "collapsing" },
  active: { REQUEST_STANDBY: "collapsing", FAILURE: "collapsing" },
  collapsing: { ANIMATION_COMPLETE: "standby", ACTIVATE: "activating" },
};

export function nextExperienceMode(mode: ExperienceMode, event: ExperienceEvent) {
  return transitions[mode][event] ?? mode;
}

export function keepDashboardOpenAfterVoiceEnd(reason: string) {
  return reason === "idle" || reason === "maximum" || reason === "tap" || reason === "background_work";
}

export const EXPERIENCE_TIMING = {
  activationMinimumMs: 450,
  collapseMs: 420,
} as const;
