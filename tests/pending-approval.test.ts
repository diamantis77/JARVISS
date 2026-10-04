import { describe, expect, it } from "vitest";
import { selectPendingApproval } from "../lib/presentation/pending-approval";
import type { Approval } from "../types";

const approval = (id: string): Approval => ({ id, runId: "run", actionType: "send_email", status: "pending", recipient: "owner@example.com", subject: "Test", preview: "Draft" });

describe("pending approval selection", () => {
  it("reveals a new pending approval after a server refresh", () => {
    expect(selectPendingApproval(null, [approval("new")])?.id).toBe("new");
  });

  it("preserves the selected approval while it remains pending", () => {
    expect(selectPendingApproval(approval("older"), [approval("new"), approval("older")])?.id).toBe("older");
  });

  it("clears an approval that is no longer pending", () => {
    expect(selectPendingApproval(approval("done"), [])).toBeNull();
  });
});
