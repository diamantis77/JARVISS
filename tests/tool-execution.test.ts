import { describe, expect, it } from "vitest";
import { executeTool } from "../lib/tools/execute";
import { createDemoRepositories } from "../lib/repositories/demo";

describe("typed tool execution", () => {
  it("executes a safe tool with scoped repositories", async () => { const result = await executeTool("search_crm", { query: "", limit: 2 }, { context: { repositories: createDemoRepositories(), mode: "demo" } }); expect(result.ok).toBe(true); if (result.ok && "count" in result.value) expect(result.value.count).toBe(2); });
  it("rejects malformed arguments before permission evaluation", async () => { const result = await executeTool("send_email", { draftId: 4 }); expect(result.ok).toBe(false); if (!result.ok) expect(result.reason).toBe("Invalid tool input"); });
});
