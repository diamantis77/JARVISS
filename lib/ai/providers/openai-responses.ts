import OpenAI from "openai";
import type { EasyInputMessage, ResponseInputItem } from "openai/resources/responses/responses";
import type { AiAdapter, AiMessage, AskAIRequest } from "../router-types";
import { capabilitiesFor, modelFor } from "../routing-config";
import { AiProviderError } from "./chat-completions";

function inputItems(request: AskAIRequest): ResponseInputItem[] {
  const input: ResponseInputItem[] = [];
  let lastUserIndex = -1;
  for (const message of request.messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      if (!message.toolCallId) throw new AiProviderError("INVALID_REQUEST", false);
      input.push({ type: "function_call_output", call_id: message.toolCallId, output: message.content });
      continue;
    }
    if (message.content) {
      input.push({ role: message.role, content: message.content });
      if (message.role === "user") lastUserIndex = input.length - 1;
    }
    if (message.role === "assistant") for (const call of message.toolCalls ?? [])
      input.push({ type: "function_call", call_id: call.callId, name: call.name, arguments: call.arguments });
  }
  if (request.images?.length) {
    if (lastUserIndex < 0) throw new AiProviderError("INVALID_REQUEST", false);
    const last = input[lastUserIndex] as EasyInputMessage;
    last.content = [
      { type: "input_text", text: typeof last.content === "string" ? last.content : "" },
      ...request.images.map(({ dataUrl }) => ({ type: "input_image" as const, image_url: dataUrl, detail: "auto" as const })),
    ];
  }
  return input;
}

function failure(error: unknown, signal: AbortSignal): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (signal.aborted || error instanceof Error && error.name === "AbortError") return new AiProviderError("TIMEOUT", true);
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 403 && error instanceof Error && /safety|moderation|content[_ -]?filter|policy[_ -]?(?:violation|refusal|blocked)/i.test(error.message.slice(0, 2048)))
    return new AiProviderError("SAFETY_REFUSAL", false, status);
  if (status === 429) return new AiProviderError("RATE_LIMIT", true, status);
  if ([500, 502, 503, 504].includes(status)) return new AiProviderError("PROVIDER_ERROR", true, status);
  if ([401, 403].includes(status)) return new AiProviderError("AUTH", true, status);
  if ([400, 422].includes(status)) return new AiProviderError("INVALID_REQUEST", false, status);
  return new AiProviderError("NETWORK", true);
}

/** Keep the existing OpenAI Responses API contract as the final, paid fallback. */
export function openAiResponsesAdapter(): AiAdapter {
  const key = process.env.OPENAI_API_KEY;
  const model = modelFor("openai");
  return {
    name: "openai", model, capabilities: capabilitiesFor("openai", model), configured: Boolean(key?.trim()),
    async ask(request, signal) {
      if (!key?.trim()) throw new AiProviderError("AUTH", true);
      const client = new OpenAI({ apiKey: key, maxRetries: 0 });
      const instructions = request.messages.filter((item: AiMessage) => item.role === "system").map((item) => item.content).join("\n\n");
      try {
        const response = await client.responses.create({
          model, instructions, input: inputItems(request), tools: request.tools,
          text: request.responseFormat ? { format: request.responseFormat.schema
            ? { type: "json_schema", name: request.responseFormat.name ?? "jarvis_output", schema: request.responseFormat.schema, strict: true }
            : { type: "json_object" } } : undefined,
          max_output_tokens: request.maxTokens, store: false,
        }, { signal });
        if (response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal")))
          throw new AiProviderError("SAFETY_REFUSAL", false);
        const outputText = response.output_text || response.output
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content.filter((part) => part.type === "output_text").map((part) => part.text)).join("");
        return {
          content: outputText, provider: "openai", model: response.model ?? model,
          finishReason: response.status ?? null,
          toolCalls: response.output.filter((item) => item.type === "function_call").map((item) => ({ callId: item.call_id, name: item.name, arguments: item.arguments })),
          usage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens, totalTokens: response.usage?.total_tokens },
        };
      } catch (error) { throw failure(error, signal); }
    },
  };
}
