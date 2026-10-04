import { z } from "zod";
import { chatCompletionAdapter, AiProviderError } from "./providers/chat-completions";
import { openAiResponsesAdapter } from "./providers/openai-responses";
import { allowPaidFallback, freeProviderOrder, timeoutFor } from "./routing-config";
import { providerCoolingDown, recordAttempt } from "./router-metrics";
import type { AiAdapter, AiAttempt, AiFailureReason, AiProviderName, AskAIRequest, AskAIResult } from "./router-types";

export class AiRoutingError extends Error {
  constructor(readonly reason: AiFailureReason | "NO_PROVIDER" | "PAID_FALLBACK_DISABLED", readonly attempts: AiAttempt[]) {
    super(reason);
    this.name = "AiRoutingError";
  }
}

function routerLog(event: string, data: Record<string, string | number | boolean | undefined>) {
  // Never include prompts, output, provider error bodies, headers, keys, or customer data.
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...data }));
}
function classify(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof SyntaxError || error instanceof z.ZodError) return new AiProviderError("INVALID_STRUCTURED_OUTPUT", true);
  return new AiProviderError("UNKNOWN", false);
}
function validateRequest(request: AskAIRequest) {
  if (!request.messages.length) throw new AiRoutingError("INVALID_REQUEST", []);
  if (request.images?.length && (request.images.length > 4 || request.images.some((item) => !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.dataUrl) || item.dataUrl.length > 8_000_000))) throw new AiRoutingError("INVALID_REQUEST", []);
  if (request.responseFormat?.schema && !request.responseFormat.validator) throw new AiRoutingError("INVALID_REQUEST", []);
}
function compatible(adapter: AiAdapter, request: AskAIRequest) {
  const cap = adapter.capabilities;
  return cap.supportsText && (!request.images?.length || cap.supportsVision) &&
    (request.taskType !== "vision" || cap.supportsVision) &&
    (!request.tools?.length || cap.supportsTools) &&
    (!request.responseFormat || cap.supportsStructuredOutput) &&
    (request.taskType !== "reasoning" || cap.supportsReasoning);
}

export async function askAI(request: AskAIRequest, options: { adapters?: Partial<Record<AiProviderName, AiAdapter>>; now?: () => number } = {}): Promise<AskAIResult> {
  validateRequest(request);
  const now = options.now ?? Date.now;
  const requestId = request.metadata?.requestId && /^[a-zA-Z0-9_-]{1,80}$/.test(request.metadata.requestId)
    ? request.metadata.requestId : crypto.randomUUID();
  const ordered: AiProviderName[] = [...freeProviderOrder(request.taskType), ...(allowPaidFallback() ? ["openai" as const] : [])];
  const attempts: AiAttempt[] = [];
  routerLog("AI_ROUTER_REQUEST", { requestId, taskType: request.taskType });
  for (const name of ordered) {
    const adapter = options.adapters?.[name] ?? (name === "openai" ? openAiResponsesAdapter() : chatCompletionAdapter(name));
    if (!adapter.configured || !compatible(adapter, request) || providerCoolingDown(name)) continue;
    const start = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutFor(name));
    try {
      routerLog("AI_PROVIDER_ATTEMPT", { requestId, taskType: request.taskType, provider: name, model: adapter.model });
      const response = await adapter.ask(request, controller.signal);
      if (!response.content.trim() && !response.toolCalls.length) throw new AiProviderError("EMPTY_OUTPUT", true);
      let parsed: unknown;
      if (request.responseFormat) {
        try {
          parsed = JSON.parse(response.content);
          if (request.responseFormat.validator) parsed = request.responseFormat.validator.parse(parsed);
          else if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON object");
        } catch { throw new AiProviderError("INVALID_STRUCTURED_OUTPUT", true); }
      }
      const latencyMs = Math.max(0, now() - start);
      attempts.push({ provider: name, model: adapter.model, success: true, latencyMs });
      recordAttempt(name, true, latencyMs, undefined, attempts.length > 1);
      routerLog("AI_PROVIDER_SUCCESS", { requestId, taskType: request.taskType, provider: name, model: response.model, latencyMs });
      return { ...response, parsed, latencyMs, attempts, fallbackUsed: attempts.length > 1 };
    } catch (rawError) {
      const failure = classify(rawError);
      const latencyMs = Math.max(0, now() - start);
      attempts.push({ provider: name, model: adapter.model, success: false, reason: failure.reason, latencyMs });
      recordAttempt(name, false, latencyMs, failure.reason, attempts.length > 1);
      routerLog("AI_PROVIDER_FAILURE", { requestId, taskType: request.taskType, provider: name, model: adapter.model, latencyMs, failureReason: failure.reason });
      if (!failure.retryable) throw new AiRoutingError(failure.reason, attempts);
      routerLog("AI_FALLBACK", { requestId, taskType: request.taskType, provider: name, failureReason: failure.reason });
    } finally { clearTimeout(timer); }
  }
  const reason = !allowPaidFallback() ? "PAID_FALLBACK_DISABLED" : attempts.length ? attempts.at(-1)!.reason ?? "UNKNOWN" : "NO_PROVIDER";
  routerLog("AI_ALL_PROVIDERS_FAILED", { requestId, taskType: request.taskType, failureReason: reason });
  throw new AiRoutingError(reason, attempts);
}
