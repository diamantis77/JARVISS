import { describe, expect, it } from "vitest";
import { createDemoRepositories } from "../lib/repositories/demo";

describe("persisted research resume and cancellation", () => {
  it("resumes only unprocessed candidates and prevents duplicate continuation claims", async () => {
    const repositories = createDemoRepositories();
    const run = await repositories.research.createRun({ jarvisRunId: null, query: "Dentists · Athens", industry: "Dentists", location: "Athens", requestedLimit: 2, config: { batchSize: 1 } });
    const candidates = await repositories.research.addCandidates(run.id, [
      { businessName: "Demo One", normalizedKey: "domain:one.example", industry: "Dentist", location: "Athens", officialWebsite: "https://one.example", phone: null, email: null, status: "discovered", sourceResults: [] },
      { businessName: "Demo Two", normalizedKey: "domain:two.example", industry: "Dentist", location: "Athens", officialWebsite: "https://two.example", phone: null, email: null, status: "discovered", sourceResults: [] },
    ]);
    await repositories.research.updateCandidate(candidates[0].id, { status: "analyzed" });
    await repositories.research.updateRun(run.id, { status: "partial", discoveredCount: 2, processedCount: 1 });
    await repositories.research.claimContinuation(run.id);
    const pending = await repositories.research.listPendingCandidates(run.id, 5);
    expect(pending.map((item) => item.id)).toEqual([candidates[1].id]);
    await expect(repositories.research.claimContinuation(run.id)).rejects.toThrow(/already active/);
  });

  it("preserves completed candidate state when cancelled", async () => {
    const repositories = createDemoRepositories();
    const run = await repositories.research.createRun({ jarvisRunId: null, query: "Clinics · Kos", industry: "Clinics", location: "Kos", requestedLimit: 1, config: {} });
    await repositories.research.cancel(run.id);
    expect(await repositories.research.getRun(run.id)).toMatchObject({ status: "cancelled" });
  });
});
