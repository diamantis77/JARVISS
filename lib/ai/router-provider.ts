import type { AiTurnRequest, AiTurnResult, JarvisAiProvider } from "./provider";
import { askAI } from "./router";
import type { AiMessage, AiToolCall } from "./router-types";

/** One instance per JARVIS run. Chat history stays server-side and is never sent to the browser. */
export class RouterJarvisProvider implements JarvisAiProvider {
  private messages: AiMessage[] = [];
  private lastToolCalls: AiToolCall[] = [];
  private lastText = "";

  async respond(request: AiTurnRequest): Promise<AiTurnResult> {
    if (request.input !== undefined) {
      this.messages = [{ role: "system", content: request.instructions }, { role: "user", content: request.input }];
      this.lastToolCalls = [];
      this.lastText = "";
    } else if (request.toolOutputs?.length && this.lastToolCalls.length) {
      this.messages.push({ role: "assistant", content: this.lastText, toolCalls: this.lastToolCalls });
      for (const item of request.toolOutputs) this.messages.push({ role: "tool", toolCallId: item.callId, content: item.output });
    } else throw new Error("AI tool turn is missing its previous tool calls");
    const result = await askAI({ messages: this.messages, taskType: "tool_calling", tools: request.tools });
    this.lastText = result.content;
    this.lastToolCalls = result.toolCalls;
    if (!result.toolCalls.length) this.messages.push({ role: "assistant", content: result.content });
    return { responseId: `routed_${crypto.randomUUID()}`, text: result.content, toolCalls: result.toolCalls,
      routing: { provider: result.provider, model: result.model, latencyMs: result.latencyMs,
        fallbackUsed: result.fallbackUsed, attempts: result.attempts } };
  }
}
