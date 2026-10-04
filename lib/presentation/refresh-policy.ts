import type { JarvisRun } from "@/types";

// The current run and spoken response are already updated locally. A full
// server-component refresh is needed only after a tool may change business data.
export function shouldRefreshAfterRun(run: Pick<JarvisRun, "steps"> | null) {
  return Boolean(run?.steps.some((step) => step.toolName && step.toolName !== "plan_request"));
}
