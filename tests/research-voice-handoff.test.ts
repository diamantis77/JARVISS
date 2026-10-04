import { describe, expect, it } from "vitest";
import { isResearchProgressEvent } from "../lib/voice/research-handoff";

const runWithStep = (toolName: string) => ({ context: {}, currentStep: 2, steps: [{ order: 2, toolName }] });

describe("voice continuity during research", () => {
  it("identifies research progress for UI without releasing the voice session", () => {
    expect(isResearchProgressEvent({ type: "step", run: runWithStep("search_leads") })).toBe(true);
    expect(isResearchProgressEvent({ type: "step", run: runWithStep("search_web") })).toBe(true);
    expect(isResearchProgressEvent({ type: "step", run: runWithStep("plan_request") })).toBe(false);
  });

  it("recognizes persisted research progress without closing voice for unrelated steps", () => {
    expect(isResearchProgressEvent({ type: "step", run: { ...runWithStep("plan_request"), context: { researchRunId: "run-1" } } })).toBe(true);
    expect(isResearchProgressEvent({ type: "step", research: { researchRunId: "run-1" } })).toBe(true);
    expect(isResearchProgressEvent({ type: "run", run: runWithStep("search_leads") })).toBe(false);
  });
});
