import type { AiCapabilities, AiProviderName, AiTaskType } from "./router-types";

const freeNames = ["groq", "gemini", "openrouter"] as const;
export const allProviders: AiProviderName[] = [...freeNames, "openai"];

export function freeProviderOrder(taskType: AiTaskType): AiProviderName[] {
  const requested = (process.env.AI_PROVIDER_ORDER ?? "groq,gemini,openrouter")
    .split(",").map((name) => name.trim().toLowerCase())
    .filter((name): name is typeof freeNames[number] => freeNames.includes(name as typeof freeNames[number]));
  const free = [...new Set(requested)];
  const complete = [...free, ...freeNames.filter((name) => !free.includes(name))];
  return taskType === "vision" ? ["gemini", ...complete.filter((name) => name !== "gemini")] : complete;
}

export function allowPaidFallback(): boolean { return process.env.AI_ALLOW_PAID_FALLBACK !== "false"; }
export function hasAnyAiProvider(): boolean {
  return Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY ||
    (process.env.OPENROUTER_API_KEY && isFreeOpenRouterModel(modelFor("openrouter"))) ||
    (allowPaidFallback() && process.env.OPENAI_API_KEY));
}
export function modelFor(provider: AiProviderName): string {
  if (provider === "groq") return process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  if (provider === "gemini") return process.env.GEMINI_MODEL || "gemini-3.8-flash";
  if (provider === "openrouter") return process.env.OPENROUTER_MODEL || "openrouter/free";
  return process.env.OPENAI_FALLBACK_MODEL || process.env.OPENAI_MODEL || "gpt-5";
}
export function isFreeOpenRouterModel(model: string): boolean {
  return model === "openrouter/free" || model.endsWith(":free");
}
export function timeoutFor(provider: AiProviderName): number {
  const value = Number(process.env[`AI_${provider.toUpperCase()}_TIMEOUT_MS`]);
  return Number.isFinite(value) && value >= 1000 && value <= 120_000 ? value : provider === "openai" ? 45_000 : 20_000;
}
export const capabilities: Record<AiProviderName, AiCapabilities> = {
  groq: { supportsText: true, supportsVision: false, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: true, supportsStreaming: true },
  gemini: { supportsText: true, supportsVision: true, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: true, supportsStreaming: true },
  openrouter: { supportsText: true, supportsVision: true, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: true, supportsStreaming: true },
  openai: { supportsText: true, supportsVision: true, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: true, supportsStreaming: true },
};
/** Unknown custom model IDs are text-only until their capabilities are reviewed here. */
export function capabilitiesFor(provider: AiProviderName, model: string): AiCapabilities {
  if (provider === "groq" && !["openai/gpt-oss-120b", "openai/gpt-oss-20b"].includes(model))
    return { ...capabilities.groq, supportsTools: false, supportsStructuredOutput: false, supportsReasoning: false };
  if (provider === "gemini" && !["gemini-3.8-flash", "gemini-3.7-flash"].includes(model))
    return { ...capabilities.gemini, supportsVision: false, supportsTools: false, supportsStructuredOutput: false, supportsReasoning: false };
  if (provider === "openrouter" && model !== "openrouter/free")
    return { ...capabilities.openrouter, supportsVision: false, supportsTools: false, supportsStructuredOutput: false, supportsReasoning: false };
  return capabilities[provider];
}
