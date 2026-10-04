import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { askAI, AiRoutingError } from "../lib/ai/router";
import { AiProviderError, chatCompletionAdapter } from "../lib/ai/providers/chat-completions";
import { openAiResponsesAdapter } from "../lib/ai/providers/openai-responses";
import { capabilities, capabilitiesFor } from "../lib/ai/routing-config";
import { resetAiProviderMetrics } from "../lib/ai/router-metrics";
import type { AiAdapter, AiProviderName, AskAIRequest } from "../lib/ai/router-types";

const request: AskAIRequest = { taskType: "general", messages: [{ role: "user", content: "Hello" }] };
function adapter(name: AiProviderName, result: "ok" | AiProviderError | (() => Promise<never>), content = "answer"): AiAdapter {
  return { name, model: `${name}-test`, configured: true, capabilities: capabilities[name],
    ask: vi.fn(async (_request, _signal) => {
      if (result instanceof AiProviderError) throw result;
      if (typeof result === "function") return result();
      return { provider: name, model: `${name}-test`, content, toolCalls: [], finishReason: "stop", usage: { totalTokens: 4 } };
    }) };
}
function adapters(groq: AiAdapter, gemini = adapter("gemini", "ok"), openrouter = adapter("openrouter", "ok"), openai = adapter("openai", "ok")) {
  return { groq, gemini, openrouter, openai };
}
beforeEach(() => {
  resetAiProviderMetrics();
  vi.stubEnv("AI_PROVIDER_ORDER", "groq,gemini,openrouter");
  vi.stubEnv("AI_ALLOW_PAID_FALLBACK", "true");
  vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("free-first AI router", () => {
  it("returns Groq directly when healthy", async () => {
    const set = adapters(adapter("groq", "ok"));
    const result = await askAI(request, { adapters: set });
    expect(result.provider).toBe("groq"); expect(result.fallbackUsed).toBe(false);
    expect(set.gemini.ask).not.toHaveBeenCalled();
  });
  it.each([429, 500, 502, 503, 504])("falls back from Groq HTTP %s to Gemini", async (status) => {
    const set = adapters(adapter("groq", new AiProviderError(status === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR", true, status)));
    const result = await askAI(request, { adapters: set });
    expect(result.provider).toBe("gemini"); expect(result.attempts).toHaveLength(2);
    expect(set.openai.ask).not.toHaveBeenCalled();
  });
  it("moves to Gemini after a real abort timeout", async () => {
    vi.stubEnv("AI_GROQ_TIMEOUT_MS", "1000");
    vi.useFakeTimers();
    const slow = adapter("groq", "ok");
    slow.ask = vi.fn((_req, signal) => new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new AiProviderError("TIMEOUT", true)), { once: true })));
    const set = adapters(slow);
    const pending = askAI(request, { adapters: set });
    await vi.advanceTimersByTimeAsync(1001);
    const result = await pending;
    expect(result.provider).toBe("gemini"); expect(result.attempts[0].reason).toBe("TIMEOUT");
  });
  it("uses OpenRouter FREE after both earlier free providers fail", async () => {
    const set = adapters(adapter("groq", new AiProviderError("NETWORK", true)), adapter("gemini", new AiProviderError("PROVIDER_ERROR", true)));
    expect((await askAI(request, { adapters: set })).provider).toBe("openrouter");
    expect(set.openai.ask).not.toHaveBeenCalled();
  });
  it("does not treat a blank provider completion as a successful answer", async () => {
    const set = adapters(adapter("groq", "ok", "  "), adapter("gemini", "ok", "answer"));
    const result = await askAI(request, { adapters: set });
    expect(result.provider).toBe("gemini");
    expect(result.attempts[0].reason).toBe("EMPTY_OUTPUT");
  });
  it("uses OpenAI only after all free providers fail and paid fallback is enabled", async () => {
    const fail = (name: AiProviderName) => adapter(name, new AiProviderError("NETWORK", true));
    const set = adapters(fail("groq"), fail("gemini"), fail("openrouter"));
    const result = await askAI(request, { adapters: set });
    expect(result.provider).toBe("openai"); expect(result.attempts).toHaveLength(4);
  });
  it("never touches OpenAI when paid fallback is disabled", async () => {
    vi.stubEnv("AI_ALLOW_PAID_FALLBACK", "false");
    const fail = (name: AiProviderName) => adapter(name, new AiProviderError("NETWORK", true));
    const set = adapters(fail("groq"), fail("gemini"), fail("openrouter"));
    await expect(askAI(request, { adapters: set })).rejects.toMatchObject({ reason: "PAID_FALLBACK_DISABLED" });
    expect(set.openai.ask).not.toHaveBeenCalled();
  });
  it.each(["INVALID_REQUEST", "SAFETY_REFUSAL"] as const)("does not provider-hop on %s", async (reason) => {
    const set = adapters(adapter("groq", new AiProviderError(reason, false)));
    await expect(askAI(request, { adapters: set })).rejects.toMatchObject({ reason });
    expect(set.gemini.ask).not.toHaveBeenCalled();
  });
  it("skips missing API keys", async () => {
    const set = adapters(adapter("groq", "ok"));
    set.groq.configured = false; set.gemini.configured = false; set.openrouter.configured = false;
    expect((await askAI(request, { adapters: set })).provider).toBe("openai");
    set.openai.configured = false;
    await expect(askAI(request, { adapters: set })).rejects.toBeInstanceOf(AiRoutingError);
  });
  it("skips one missing free key at a time", async () => {
    const set = adapters(adapter("groq", "ok"));
    set.groq.configured = false;
    expect((await askAI(request, { adapters: set })).provider).toBe("gemini");
    set.gemini.configured = false;
    expect((await askAI(request, { adapters: set })).provider).toBe("openrouter");
  });
  it("validates structured output and falls back on invalid JSON", async () => {
    const set = adapters(adapter("groq", "ok", "not-json"), adapter("gemini", "ok", '{"count":2}'));
    const result = await askAI({ ...request, taskType: "extraction", responseFormat: { type: "json", name: "count", schema: { type: "object", additionalProperties: false, required: ["count"], properties: { count: { type: "number" } } }, validator: z.object({ count: z.number() }) } }, { adapters: set });
    expect(result.provider).toBe("gemini"); expect(result.parsed).toEqual({ count: 2 });
    expect(result.attempts[0].reason).toBe("INVALID_STRUCTURED_OUTPUT");
  });
  it("routes tool calls only to tool-capable providers", async () => {
    const set = adapters(adapter("groq", "ok"));
    set.groq.capabilities = { ...set.groq.capabilities, supportsTools: false };
    const result = await askAI({ ...request, taskType: "tool_calling", tools: [{ type: "function", name: "read_crm", description: "Read", parameters: { type: "object", properties: {} }, strict: true }] }, { adapters: set });
    expect(result.provider).toBe("gemini"); expect(set.groq.ask).not.toHaveBeenCalled();
  });
  it("never sends vision to text-only Groq", async () => {
    const set = adapters(adapter("groq", "ok"));
    const result = await askAI({ ...request, taskType: "vision", images: [{ dataUrl: "data:image/png;base64,YQ==" }] }, { adapters: set });
    expect(result.provider).toBe("gemini"); expect(set.groq.ask).not.toHaveBeenCalled();
  });
  it("skips authentication errors and does not expose key material in failures", async () => {
    const set = adapters(adapter("groq", new AiProviderError("AUTH", true, 401)));
    expect((await askAI(request, { adapters: set })).provider).toBe("gemini");
    expect(JSON.stringify((await askAI(request, { adapters: set })).attempts)).not.toContain("Bearer");
  });
  it("keeps unknown custom models away from tools/vision until capability-reviewed", () => {
    expect(capabilitiesFor("groq", "new-unknown-model").supportsTools).toBe(false);
    expect(capabilitiesFor("gemini", "new-unknown-model").supportsVision).toBe(false);
    expect(capabilitiesFor("openrouter", "vendor/unknown:free").supportsStructuredOutput).toBe(false);
  });
  it("refuses a paid OpenRouter slug even with a configured key", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-placeholder");
    vi.stubEnv("OPENROUTER_MODEL", "vendor/paid-model");
    expect(chatCompletionAdapter("openrouter").configured).toBe(false);
  });
  it("sends an OpenRouter free model and never returns its credential", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fake-private-key");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ model: "free-model", choices: [{ finish_reason: "stop", message: { content: "hello" } }], usage: { total_tokens: 3 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await chatCompletionAdapter("openrouter").ask(request, new AbortController().signal);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sentBody.model).toBe("openrouter/free");
    expect(JSON.stringify(result)).not.toContain("fake-private-key");
    vi.unstubAllGlobals();
  });
  it("preserves Gemini thought signatures when returning tool results", async () => {
    vi.stubEnv("GEMINI_API_KEY", "fake-private-key");
    const signature = "opaque-provider-signature";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "read_crm", arguments: "{}" }, extra_content: { google: { thought_signature: signature } } }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "Done" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const model = chatCompletionAdapter("gemini");
    const tools = [{ type: "function" as const, name: "read_crm", description: "Read", parameters: { type: "object", properties: {} }, strict: false }];
    const first = await model.ask({ ...request, tools }, new AbortController().signal);
    expect(first.toolCalls[0].thoughtSignature).toBe(signature);
    await model.ask({ ...request, tools, messages: [...request.messages, { role: "assistant", content: "", toolCalls: first.toolCalls }, { role: "tool", toolCallId: "call_1", content: "{}" }] }, new AbortController().signal);
    const sent = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(sent.messages[1].tool_calls[0].extra_content.google.thought_signature).toBe(signature);
    expect(JSON.stringify(first)).not.toContain("fake-private-key");
    vi.unstubAllGlobals();
  });
  it("uses the documented Gemini transfer marker for tool calls from a different provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", "fake-private-key");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "Done" } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await chatCompletionAdapter("gemini").ask({ ...request, messages: [...request.messages, { role: "assistant", content: "", toolCalls: [{ callId: "groq_call", name: "read_crm", arguments: "{}" }] }, { role: "tool", toolCallId: "groq_call", content: "{}" }] }, new AbortController().signal);
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.messages[1].tool_calls[0].extra_content.google.thought_signature).toBe("skip_thought_signature_validator");
    vi.unstubAllGlobals();
  });
  it("simulates Groq 429 only in local development", async () => {
    vi.stubEnv("GROQ_API_KEY", "fake-key");
    vi.stubEnv("AI_DEV_FORCE_GROQ_429", "true");
    vi.stubEnv("NODE_ENV", "development");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(chatCompletionAdapter("groq").ask(request, new AbortController().signal)).rejects.toMatchObject({ reason: "RATE_LIMIT" });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("does not route around an HTTP 403 safety refusal", async () => {
    vi.stubEnv("GROQ_API_KEY", "fake-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":"moderation_blocked"}}', { status: 403 })));
    await expect(chatCompletionAdapter("groq").ask(request, new AbortController().signal)).rejects.toMatchObject({ reason: "SAFETY_REFUSAL" });
    vi.unstubAllGlobals();
  });
  it("keeps the paid fallback on the existing OpenAI Responses API without SDK retries", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-private-key");
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      id: "resp_test", model: "gpt-5", status: "completed", output: [{ type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{ type: "output_text", text: "hello", annotations: [] }] }],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await openAiResponsesAdapter().ask(request, new AbortController().signal);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v1/responses");
    expect(JSON.parse(String(init?.body)).store).toBe(false);
    expect(result.content).toBe("hello");
    expect(JSON.stringify(result)).not.toContain("fake-private-key");
    vi.unstubAllGlobals();
  });
  it("preserves tool call and tool output history through the paid Responses fallback", async () => {
    vi.stubEnv("OPENAI_API_KEY", "fake-private-key");
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      id: "resp_tool", model: "gpt-5", status: "completed", output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "read_crm", arguments: "{}" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const toolRequest: AskAIRequest = { taskType: "tool_calling", messages: [
      { role: "system", content: "Read only" }, { role: "user", content: "Show CRM" },
      { role: "assistant", content: "", toolCalls: [{ callId: "call_1", name: "read_crm", arguments: "{}" }] },
      { role: "tool", toolCallId: "call_1", content: "one lead" },
    ] };
    const result = await openAiResponsesAdapter().ask(toolRequest, new AbortController().signal);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.input.map((item: { type?: string }) => item.type)).toContain("function_call_output");
    expect(result.toolCalls).toEqual([{ callId: "call_1", name: "read_crm", arguments: "{}" }]);
    vi.unstubAllGlobals();
  });
});
