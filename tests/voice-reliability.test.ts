import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyAmbientNoise, createCalibration } from "../lib/voice/browser-audio";
import { extractWakeCommand, matchesWakePhrase, wakeConfidenceThreshold } from "../lib/voice/wake-word";

describe("voice reliability primitives", () => {
  it("supports sensitivity without accepting ordinary mentions", () => {
    expect(wakeConfidenceThreshold("low")).toBeGreaterThan(wakeConfidenceThreshold("normal"));
    expect(wakeConfidenceThreshold("normal")).toBeGreaterThan(wakeConfidenceThreshold("high"));
    expect(matchesWakePhrase("Hey Jarvis", .25, "high")).toBe(true);
    expect(matchesWakePhrase("Hey Jarvis", .25, "low")).toBe(false);
    expect(matchesWakePhrase("we discussed Jarvis yesterday", .99, "high")).toBe(false);
  });

  it("preserves the command after a combined wake phrase", () => {
    expect(extractWakeCommand("Hey Jarvis, τι έγινε σήμερα;")).toBe("τι έγινε σήμερα;");
    expect(extractWakeCommand("Χέι Τζάρβις δείξε μου τα hot leads")).toBe("δείξε μου τα hot leads");
    expect(extractWakeCommand("Hey Jarvis")).toBe("");
  });

  it("creates calibration only from measurably distinct voice", () => {
    expect(createCalibration([.03, .031, .029], [.15, .18, .16])?.speechThreshold).toBeGreaterThan(.03);
    expect(createCalibration([.08, .081], [.085, .09])).toBeNull();
    expect(classifyAmbientNoise(.03)).toBe("low");
    expect(classifyAmbientNoise(.1)).toBe("medium");
    expect(classifyAmbientNoise(.2)).toBe("high");
  });

  it("hands the selected wake stream to Live instead of opening it again", () => {
    const wake = readFileSync(new URL("../lib/voice/browser-wake-word-provider.ts", import.meta.url), "utf8");
    const live = readFileSync(new URL("../lib/voice/browser-provider.ts", import.meta.url), "utf8");
    const center = readFileSync(new URL("../components/command-center.tsx", import.meta.url), "utf8");
    expect(wake).toContain("handoffStream");
    expect(live).toContain("this.options.initialStream");
    expect(center).toContain("initialStream");
    expect(center).toContain("extractWakeCommand");
    expect(center).toContain("handingOff && snapshot.state === \"idle\"");
    expect(wake).toContain("this.recognition !== recognition");
  });

  it("reacts to device changes and applies only supported constraints", () => {
    const diagnostics = readFileSync(new URL("../components/voice-diagnostics.tsx", import.meta.url), "utf8");
    const audio = readFileSync(new URL("../lib/voice/browser-audio.ts", import.meta.url), "utf8");
    expect(diagnostics).toContain('addEventListener("devicechange"');
    expect(audio).toContain("getSupportedConstraints");
    expect(audio).toContain("supported.echoCancellation");
    expect(audio).toContain("supported.noiseSuppression");
    expect(audio).toContain("supported.autoGainControl");
    expect(audio).toContain('track.contentHint = "speech"');
    expect(audio).toContain("supported.sampleRate");
  });

  it("meters assistant audio without adding a second audible playback path", () => {
    const live = readFileSync(new URL("../lib/voice/browser-provider.ts", import.meta.url), "utf8");
    expect(live).toContain("sink.gain.value = 0");
    expect(live).toContain("analyser.connect(sink)");
    expect(live).toContain("this.outputSink?.disconnect()");
  });

  it("waits for uneven Live transcript fragments before delegating", () => {
    const live = readFileSync(new URL("../lib/voice/browser-provider.ts", import.meta.url), "utf8");
    expect(live).toContain("inputFragments");
    expect(live).toContain("schedulePendingDelegation(320)");
    expect(live).toContain("event.offset_ms");
    expect(live).toContain("Δεν σας άκουσα καθαρά");
  });

  it("prompts GPT-Live in Greek with explicit listening policy", () => {
    const instructions = readFileSync(new URL("../lib/voice/instructions.ts", import.meta.url), "utf8");
    expect(instructions).toContain("Πολιτική ακρόασης");
    expect(instructions).toContain("Backchannel policy");
    expect(instructions).toContain("Interruption policy");
    expect(instructions).toContain("θόρυβο περιβάλλοντος");
  });
});
