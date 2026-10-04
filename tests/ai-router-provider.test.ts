import { describe, expect, it, vi } from "vitest";

const ask = vi.hoisted(() => vi.fn());
vi.mock("../lib/ai/router", () => ({ askAI: ask }));
import { RouterJarvisProvider } from "../lib/ai/router-provider";

describe("JARVIS router tool-session adapter", () => {
  it("keeps the typed tool transcript across provider turns without executing tools itself", async () => {
    ask.mockResolvedValueOnce({ content: "", provider: "groq", model: "openai/gpt-oss-120b", latencyMs: 12, fallbackUsed: false,
      attempts: [{ provider: "groq", model: "openai/gpt-oss-120b", success: true, latencyMs: 12 }],
      toolCalls: [{ callId: "call_1", name: "search_crm", arguments: "{}" }] });
    ask.mockResolvedValueOnce({ content: "Found the lead.", provider: "gemini", model: "gemini-3.8-flash", latencyMs: 20, fallbackUsed: true,
      attempts: [{ provider: "groq", model: "openai/gpt-oss-120b", success: false, reason: "RATE_LIMIT", latencyMs: 3 }, { provider: "gemini", model: "gemini-3.8-flash", success: true, latencyMs: 20 }], toolCalls: [] });
    const provider = new RouterJarvisProvider();
    const tools = [{ type: "function" as const, name: "search_crm", description: "Search CRM", parameters: { type: "object", properties: {} }, strict: true }];
    const first = await provider.respond({ instructions: "Safe tools only", input: "Find lead", tools });
    expect(first.toolCalls).toHaveLength(1);
    const second = await provider.respond({ instructions: "Safe tools only", previousResponseId: first.responseId,
      toolOutputs: [{ callId: "call_1", output: '{"leads":[]}' }], tools });
    expect(second.text).toBe("Found the lead.");
    expect(second.routing?.provider).toBe("gemini");
    const secondRequest = ask.mock.calls[1][0];
    expect(secondRequest.messages.slice(0, 4).map((item: { role: string }) => item.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(secondRequest.messages[2].toolCalls[0].name).toBe("search_crm");
    expect(secondRequest.messages[3].toolCallId).toBe("call_1");
  });
});
