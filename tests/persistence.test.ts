import { describe, expect, it } from "vitest";
import { createDemoRepositories } from "../lib/repositories/demo";

describe("run and approval persistence contracts", () => {
  it("creates runs, steps, and approval records", async () => { const repositories = createDemoRepositories(); const run = await repositories.runs.createRun("Test run"); const step = await repositories.runs.addStep(run.id, { order: 1, title: "Safe step", description: "Persisted", status: "completed" }); const approval = await repositories.approvals.create({ runId: run.id, actionType: "send_email", payload: { toolName: "send_email", input: {} } }); expect((await repositories.runs.getRun(run.id))?.steps[0].id).toBe(step.id); expect((await repositories.approvals.getById(approval.id))?.status).toBe("pending"); });
  it("claims an approval once before side-effect execution", async () => { const repositories = createDemoRepositories(); const run = await repositories.runs.createRun("Approval run"); const approval = await repositories.approvals.create({ runId: run.id, actionType: "send_email", payload: { toolName: "send_email", input: { draftId: "draft-1" } } }); await expect(repositories.approvals.claimForExecution(approval.id)).resolves.toMatchObject({ status: "approved" }); await expect(repositories.approvals.claimForExecution(approval.id)).rejects.toThrow("Approval not pending"); });
});
