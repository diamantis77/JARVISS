import { describe, expect, it } from "vitest";
import { getCoreAudioEnergy, getCoreHumanStatus, getCoreVisualState, getOperationLabel, smoothCoreAudioEnergy } from "../lib/presentation/core-state";

describe("central JARVIS core presentation state", () => {
  it.each([
    ["idle", "wake_detected", "wake"],
    ["idle", "wake_waiting", "wake"],
    ["executing", "wake_waiting", "executing"],
    ["idle", "listening", "listening"],
    ["idle", "user_speaking", "user-speaking"],
    ["idle", "interrupted", "interrupted"],
    ["idle", "processing", "thinking"],
    ["idle", "disconnected", "offline"],
    ["thinking", "idle", "thinking"],
    ["executing", "idle", "executing"],
    ["idle", "jarvis_speaking", "speaking"],
    ["success", "idle", "success"],
    ["error", "idle", "error"],
  ] as const)("maps %s / %s to %s", (app, voice, expected) => {
    expect(getCoreVisualState(app, voice)).toBe(expected);
  });

  it("prioritizes real voice state over the general run state", () => {
    expect(getCoreVisualState("executing", "jarvis_speaking")).toBe("speaking");
    expect(getCoreHumanStatus("thinking", "user_speaking")).toBe("Σας ακούω.");
  });

  it("shows a Greek operation label for known tools", () => {
    expect(getOperationLabel("analyze_website")).toBe("ΑΝΑΛΥΩ WEBSITE");
    expect(getOperationLabel("list_calendar_events")).toBe("ΕΛΕΓΧΩ ΗΜΕΡΟΛΟΓΙΟ");
  });

  it("uses actual audio energy and clears stale output immediately on interruption", () => {
    expect(getCoreAudioEnergy("listening", .5, 0).energy).toBeGreaterThan(0);
    expect(getCoreAudioEnergy("wake", .5, 0).energy).toBeGreaterThan(0);
    expect(getCoreAudioEnergy("listening", .02, 0).energy).toBe(0);
    expect(getCoreAudioEnergy("user-speaking", 0.63, 0.7)).toEqual({ input: 0.63, output: 0.7, energy: 0.63 });
    expect(getCoreAudioEnergy("speaking", 0.3, 0.72)).toEqual({ input: 0.3, output: 0.72, energy: 0.72 });
    expect(getCoreAudioEnergy("interrupted", 0.8, 0.9)).toEqual({ input: 0.8, output: 0, energy: 0 });
    expect(getCoreAudioEnergy("speaking", Number.NaN, 8)).toEqual({ input: 0, output: 1, energy: 1 });
    expect(smoothCoreAudioEnergy({ input: 0, output: .8, energy: .8 }, { input: .4, output: 0, energy: 0 }, "interrupted")).toEqual({ input: .4, output: 0, energy: 0 });
    expect(smoothCoreAudioEnergy({ input: 0, output: .8, energy: .8 }, getCoreAudioEnergy("listening", .5, 0), "listening").energy).toBeGreaterThan(0);
    const next = smoothCoreAudioEnergy({ input: 0, output: 0, energy: 0 }, { input: 1, output: 0, energy: 1 }, "user-speaking");
    expect(next.energy).toBeGreaterThan(0);
    expect(next.energy).toBeLessThan(1);
  });
});
