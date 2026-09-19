import { describe, expect, it } from "vitest";
import { mayExecute } from "../lib/tools/registry";
import { executeTool } from "../lib/tools/execute";
describe("tool permissions", () => { it("does not execute an approval-only action without approval", async () => { expect(mayExecute("REQUIRES_USER_APPROVAL", false)).toBe(false); const result = await executeTool("send_email", { draftId: "draft_1" }); expect(result).toEqual({ ok: false, reason: "Approval required" }); }); it("allows safe internal operations", () => expect(mayExecute("SAFE_AUTOMATIC", false)).toBe(true)); });
