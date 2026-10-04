import type { AiAdapter, AiFailureReason, AiMessage, AiProviderName, AskAIRequest } from "../router-types";
import { capabilitiesFor, isFreeOpenRouterModel, modelFor } from "../routing-config";

export class AiProviderError extends Error {
  constructor(readonly reason: AiFailureReason, readonly retryable: boolean, readonly status?: number) {
    super(reason);
    this.name = "AiProviderError";
  }
}

function httpFailure(status: number): AiProviderError {
  if (status === 429) return new AiProviderError("RATE_LIMIT", true, status);
  if ([500, 502, 503, 504].includes(status)) return new AiProviderError("PROVIDER_ERROR", true, status);
  if (status === 401 || status === 403) return new AiProviderError("AUTH", true, status);
  if (status === 400 || status === 422) return new AiProviderError("INVALID_REQUEST", false, status);
  return new AiProviderError("PROVIDER_ERROR", false, status);
}

const endpoints: Record<AiProviderName, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
};

function keyFor(name: AiProviderName): string | undefined {
  return process.env[name === "openrouter" ? "OPENROUTER_API_KEY" : `${name.toUpperCase()}_API_KEY`];
}

function chatMessage(message: AiMessage, provider: AiProviderName) {
  if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  if (message.role === "assistant" && message.toolCalls?.length) return {
    role: "assistant", content: message.content || null,
    tool_calls: message.toolCalls.map((call, index) => ({ id: call.callId, type: "function", function: { name: call.name, arguments: call.arguments },
      ...(provider === "gemini" && (call.thoughtSignature || index === 0) ? { extra_content: { google: { thought_signature: call.thoughtSignature ?? "skip_thought_signature_validator" } } } : {}) })),
  };
  return { role: message.role, content: message.content };
}

export function chatCompletionAdapter(name: AiProviderName): AiAdapter {
  const model = modelFor(name);
  const key = keyFor(name);
  return {
    name, model, capabilities: capabilitiesFor(name, model), configured: Boolean(key?.trim()) && (name !== "openrouter" || isFreeOpenRouterModel(model)),
    async ask(request: AskAIRequest, signal: AbortSignal) {
      if (!key?.trim()) throw new AiProviderError("AUTH", true);
      if (name === "groq" && process.env.NODE_ENV === "development" && process.env.AI_DEV_FORCE_GROQ_429 === "true")
        throw new AiProviderError("RATE_LIMIT", true, 429);
      // A per-request hint cannot silently switch an account to an unreviewed or paid model.
      const selectedModel = request.preferredModel === model ? request.preferredModel : model;
      if (name === "openrouter" && !isFreeOpenRouterModel(model)) throw new AiProviderError("UNSUPPORTED", false);
      const messages: Array<Record<string, unknown>> = request.messages.map((message) => chatMessage(message, name));
      if (request.images?.length) {
        const lastUser = [...messages].reverse().find((item) => item.role === "user");
        if (!lastUser) throw new AiProviderError("INVALID_REQUEST", false);
        lastUser.content = [
          { type: "text", text: lastUser.content },
          ...request.images.map(({ dataUrl }) => ({ type: "image_url", image_url: { url: dataUrl } })),
        ];
      }
      const body: Record<string, unknown> = { model: selectedModel, messages, stream: false };
      if (request.tools?.length) body.tools = request.tools.map((tool) => ({ type: "function", function: {
        name: tool.name, description: tool.description, parameters: tool.parameters, strict: tool.strict,
      } }));
      if (request.responseFormat) body.response_format = request.responseFormat.schema
        ? { type: "json_schema", json_schema: { name: request.responseFormat.name ?? "jarvis_output", strict: true, schema: request.responseFormat.schema } }
        : { type: "json_object" };
      if (request.temperature !== undefined) body.temperature = request.temperature;
      if (request.maxTokens !== undefined) body.max_completion_tokens = request.maxTokens;
      if (name === "openrouter" && (request.tools?.length || request.responseFormat)) body.provider = { require_parameters: true };
      let response: Response;
      try {
        response = await fetch(endpoints[name], {
          method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body), signal,
        });
      } catch (error) {
        if (signal.aborted || error instanceof Error && error.name === "AbortError") throw new AiProviderError("TIMEOUT", true);
        throw new AiProviderError("NETWORK", true);
      }
      if (!response.ok) {
        // Some gateways return policy refusals as 403 rather than a normal
        // completion refusal. Never provider-hop around those denials.
        if (response.status === 403) {
          const denial = await response.text().catch(() => "");
          if (/safety|moderation|content[_ -]?filter|policy[_ -]?(?:violation|refusal|blocked)/i.test(denial.slice(0, 2048)))
            throw new AiProviderError("SAFETY_REFUSAL", false, 403);
        }
        throw httpFailure(response.status);
      }
      const payload = await response.json().catch(() => { throw new AiProviderError("PROVIDER_ERROR", true); }) as {
        model?: string; choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string }; extra_content?: { google?: { thought_signature?: string } } }> } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const choice = payload.choices?.[0];
      if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new AiProviderError("SAFETY_REFUSAL", false);
      if (!choice?.message) throw new AiProviderError("PROVIDER_ERROR", true);
      return {
        content: choice.message.content ?? "", provider: name, model: payload.model ?? selectedModel,
        finishReason: choice.finish_reason ?? null,
        toolCalls: (choice.message.tool_calls ?? []).map((call) => ({ callId: call.id, name: call.function.name, arguments: call.function.arguments,
          ...(name === "gemini" && call.extra_content?.google?.thought_signature ? { thoughtSignature: call.extra_content.google.thought_signature } : {}) })),
        usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens, totalTokens: payload.usage?.total_tokens },
      };
    },
  };
}
