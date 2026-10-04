const researchTools = new Set(["search_leads", "search_web", "continue_research", "analyze_website"]);

type ResearchProgressEvent = {
  type: string;
  run?: { context?: Record<string, unknown>; currentStep: number; steps: Array<{ order: number; toolName?: string | null }> };
  research?: { researchRunId: string };
};

// Research progress is a UI signal only. It must not close an active voice turn.
export function isResearchProgressEvent(event: ResearchProgressEvent) {
  if (event.research?.researchRunId || typeof event.run?.context?.researchRunId === "string") return true;
  if (event.type !== "step" || !event.run) return false;
  const activeStep = event.run.steps.find((step) => step.order === event.run?.currentStep);
  return researchTools.has(activeStep?.toolName ?? "");
}
