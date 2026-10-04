import { describe, expect, it } from "vitest";
import { keepDashboardOpenAfterVoiceEnd, nextExperienceMode } from "../lib/presentation/experience-state";

describe("command center experience state", () => {
  it("moves through standby, activation, active, and a controlled collapse", () => {
    let mode = nextExperienceMode("standby", "ACTIVATE");
    expect(mode).toBe("activating");
    mode = nextExperienceMode(mode, "VOICE_READY");
    expect(mode).toBe("active");
    mode = nextExperienceMode(mode, "REQUEST_STANDBY");
    expect(mode).toBe("collapsing");
    expect(nextExperienceMode(mode, "ANIMATION_COMPLETE")).toBe("standby");
  });

  it("supports a second wake cycle and fails closed to standby", () => {
    expect(nextExperienceMode("collapsing", "ACTIVATE")).toBe("activating");
    expect(nextExperienceMode("activating", "FAILURE")).toBe("collapsing");
    expect(nextExperienceMode("collapsing", "ANIMATION_COMPLETE")).toBe("standby");
  });

  it("survives ten consecutive activation cycles without an invalid state", () => {
    let mode = "standby" as const;
    for (let cycle = 0; cycle < 10; cycle += 1) {
      const activating = nextExperienceMode(mode, "ACTIVATE");
      expect(activating).toBe("activating");
      const active = nextExperienceMode(activating, "VOICE_READY");
      expect(active).toBe("active");
      const collapsing = nextExperienceMode(active, "REQUEST_STANDBY");
      expect(collapsing).toBe("collapsing");
      mode = nextExperienceMode(collapsing, "ANIMATION_COMPLETE") as "standby";
      expect(mode).toBe("standby");
    }
  });

  it("keeps the command center visible after timed voice endings only", () => {
    expect(keepDashboardOpenAfterVoiceEnd("idle")).toBe(true);
    expect(keepDashboardOpenAfterVoiceEnd("maximum")).toBe(true);
    expect(keepDashboardOpenAfterVoiceEnd("tap")).toBe(true);
    expect(keepDashboardOpenAfterVoiceEnd("background_work")).toBe(true);
    expect(keepDashboardOpenAfterVoiceEnd("explicit")).toBe(false);
    expect(keepDashboardOpenAfterVoiceEnd("manual")).toBe(false);
    expect(keepDashboardOpenAfterVoiceEnd("failure")).toBe(false);
    expect(nextExperienceMode("active", "VOICE_READY")).toBe("active");
  });
});
