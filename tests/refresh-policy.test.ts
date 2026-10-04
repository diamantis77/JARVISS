import { describe, expect, it } from "vitest";
import { shouldRefreshAfterRun } from "../lib/presentation/refresh-policy";
import type { JarvisRunStep } from "../types";

const step = (toolName?: string): JarvisRunStep => ({ id: "step-1", order: 1, title: "Test", description: "Test", status: "completed", toolName });

describe("command center refresh policy", () => {
  it("does not refetch the whole dashboard after a conversational response", () => {
    expect(shouldRefreshAfterRun({ steps: [step("plan_request")] })).toBe(false);
    expect(shouldRefreshAfterRun(null)).toBe(false);
  });

  it("refreshes business data after a tool executes", () => {
    expect(shouldRefreshAfterRun({ steps: [step("plan_request"), step("search_crm")] })).toBe(true);
    expect(shouldRefreshAfterRun({ steps: [step("create_task")] })).toBe(true);
  });
});
