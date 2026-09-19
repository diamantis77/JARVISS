import { describe, expect, it } from "vitest";
import type { AiTurnRequest, AiTurnResult, JarvisAiProvider } from "../lib/ai/provider";
import { runJarvisLoop } from "../lib/jarvis/tool-loop";
import { createDemoRepositories } from "../lib/repositories/demo";

class QueueProvider implements JarvisAiProvider {
  constructor(private readonly turns: AiTurnResult[]) {}
  requests: AiTurnRequest[] = [];
  async respond(request: AiTurnRequest) { this.requests.push(request); const turn = this.turns.shift(); if (!turn) throw new Error("No mocked turn"); return turn; }
}
const turn = (text: string, toolCalls: AiTurnResult["toolCalls"] = []): AiTurnResult => ({ responseId: `response_${crypto.randomUUID()}`, text, toolCalls });

describe("JARVIS tool loop", () => {
  it("persists a direct response with no tool", async () => { const repositories = createDemoRepositories(); const result = await runJarvisLoop({ command: "Hello", mode: "demo", repositories, provider: new QueueProvider([turn("Ready.")]) }); expect(result.run.status).toBe("completed"); expect(result.message).toBe("Ready."); expect((await repositories.runs.getRun(result.run.id))?.steps).toHaveLength(1); });
  it("executes one safe tool and returns its output to the model", async () => { const provider = new QueueProvider([turn("", [{ callId: "call_1", name: "search_crm", arguments: '{"query":"","limit":2}' }]), turn("Found two leads.")]); const result = await runJarvisLoop({ command: "Strongest leads", mode: "demo", repositories: createDemoRepositories(), provider }); expect(result.run.status).toBe("completed"); expect(provider.requests[1].toolOutputs?.[0].output).toContain('"count":2'); });
  it("handles multiple safe tool calls", async () => { const provider = new QueueProvider([turn("", [{ callId: "call_1", name: "search_crm", arguments: '{"query":"","limit":1}' }, { callId: "call_2", name: "get_activity_log", arguments: '{"limit":2}' }]), turn("Briefing ready.")]); const result = await runJarvisLoop({ command: "Briefing", mode: "demo", repositories: createDemoRepositories(), provider }); expect(result.run.steps.filter((step) => step.status === "completed")).toHaveLength(3); });
  it("pauses an approval-required tool without executing it", async () => { const repositories = createDemoRepositories(); const provider = new QueueProvider([turn("", [{ callId: "call_send", name: "send_email", arguments: '{"draftId":"d1","recipient":"demo@example.com","subject":"Hello","preview":"Draft"}' }])]); const result = await runJarvisLoop({ command: "Send it", mode: "demo", repositories, provider }); expect(result.run.status).toBe("waiting_for_approval"); expect(result.approval?.status).toBe("pending"); expect(await repositories.approvals.getPending()).toHaveLength(2); });
  it("records malformed tool failure and lets the model recover", async () => { const provider = new QueueProvider([turn("", [{ callId: "bad", name: "create_task", arguments: "not-json" }]), turn("I could not create the task safely.")]); const result = await runJarvisLoop({ command: "Create task", mode: "demo", repositories: createDemoRepositories(), provider }); expect(result.run.status).toBe("completed"); expect(result.run.steps.some((step) => step.status === "failed")).toBe(true); });
});
