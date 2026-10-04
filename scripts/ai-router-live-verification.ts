import { loadEnvConfig } from "@next/env";
import { askAI, AiRoutingError } from "../lib/ai/router";
import { aiProviderSnapshot } from "../lib/ai/router-metrics";
import { modelFor } from "../lib/ai/routing-config";
import { chatCompletionAdapter, AiProviderError } from "../lib/ai/providers/chat-completions";
import type { AiAdapter, AiProviderName, AskAIRequest } from "../lib/ai/router-types";

// Harmless live provider smoke test. Never prints prompts, responses, keys, or headers.
loadEnvConfig(process.cwd(), true);
const initial = {
  groqFault: process.env.AI_DEV_FORCE_GROQ_429,
  geminiKey: process.env.GEMINI_API_KEY,
  openRouterKey: process.env.OPENROUTER_API_KEY,
  paid: process.env.AI_ALLOW_PAID_FALLBACK,
};
const request: AskAIRequest = {
  taskType: "general",
  messages: [{ role: "user", content: "Απάντησε μόνο: Η Αθήνα είναι η πρωτεύουσα της Ελλάδας." }],
  maxTokens: 384,
};
type VerificationReport = { label: string; success: boolean; provider?: AiProviderName; model?: string;
  fallbackUsed?: boolean; reason?: string; attempts?: unknown; usage?: unknown };
function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}
function summary(error: unknown) {
  if (error instanceof AiRoutingError) return { success: false, reason: error.reason,
    attempts: error.attempts.map(({ provider, model, success, reason, latencyMs }) => ({ provider, model, success, reason, latencyMs })) };
  return { success: false, reason: error instanceof Error ? error.name : "UNKNOWN" };
}
async function verify(label: string, options?: { adapters?: Partial<Record<AiProviderName, AiAdapter>> }): Promise<VerificationReport> {
  try {
    const result = await askAI(request, options);
    const report: VerificationReport = { label, success: Boolean(result.content.trim()), provider: result.provider,
      model: result.model, fallbackUsed: result.fallbackUsed,
      attempts: result.attempts, usage: result.usage };
    console.log(JSON.stringify(report));
    return report;
  } catch (error) {
    const report: VerificationReport = { label, ...summary(error) };
    console.log(JSON.stringify(report));
    return report;
  }
}

async function main() {
  if (process.argv.includes("--gemini-only")) {
    try {
      const result = await chatCompletionAdapter("gemini").ask(request, new AbortController().signal);
      console.log(JSON.stringify({ label: "gemini_direct", success: Boolean(result.content.trim()), model: result.model,
        finishReason: result.finishReason, outputTokens: result.usage.outputTokens }));
    } catch (error) {
      console.log(JSON.stringify({ label: "gemini_direct", success: false,
        reason: error instanceof AiProviderError ? error.reason : error instanceof Error ? error.name : "UNKNOWN",
        httpStatus: error instanceof AiProviderError ? error.status : undefined }));
    }
    return;
  }
  console.log(JSON.stringify({ label: "configured", providers: ["groq", "gemini", "openrouter", "openai"].map((name) => ({
    provider: name, configured: Boolean(process.env[`${name.toUpperCase()}_API_KEY`]?.trim()),
    model: modelFor(name as AiProviderName),
  })), paidFallbackEnabled: process.env.AI_ALLOW_PAID_FALLBACK !== "false" }));
  try {
    // Never permit this verification script to incur a paid OpenAI call.
    process.env.AI_ALLOW_PAID_FALLBACK = "false";
    process.env.AI_DEV_FORCE_GROQ_429 = "false";
    const normal = await verify("normal");
    process.env.AI_DEV_FORCE_GROQ_429 = "true";
    const gemini = await verify("groq_to_gemini");
    process.env.GEMINI_API_KEY = "";
    const openRouter = await verify("groq_to_openrouter_free");
    process.env.OPENROUTER_API_KEY = "";
    process.env.AI_ALLOW_PAID_FALLBACK = "false";
    // If the paid guard regresses, this adapter makes the mistake observable without billing.
    let paidCalled = false;
    const paidSpy: AiAdapter = { name: "openai", model: modelFor("openai"), configured: true,
      capabilities: { supportsText: true, supportsVision: true, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: true, supportsStreaming: true },
      async ask() { paidCalled = true; throw new Error("Paid adapter must not be called"); } };
    const paidGuard = await verify("paid_fallback_disabled", { adapters: { openai: paidSpy } });
    console.log(JSON.stringify({ label: "paid_guard", openAiCalled: paidCalled }));
    const passed = normal.success && normal.provider === "groq" && normal.fallbackUsed === false && normal.model === modelFor("groq") &&
      gemini.success && gemini.provider === "gemini" && gemini.fallbackUsed === true &&
      openRouter.success && openRouter.provider === "openrouter" && openRouter.model?.endsWith(":free") === true &&
      paidGuard.success === false && paidGuard.reason === "PAID_FALLBACK_DISABLED" && !paidCalled;
    console.log(JSON.stringify({ label: "overall", passed }));
    if (!passed) process.exitCode = 1;
  } finally {
    restore("AI_DEV_FORCE_GROQ_429", initial.groqFault);
    restore("GEMINI_API_KEY", initial.geminiKey);
    restore("OPENROUTER_API_KEY", initial.openRouterKey);
    restore("AI_ALLOW_PAID_FALLBACK", initial.paid);
  }
  console.log(JSON.stringify({ label: "metrics", providers: aiProviderSnapshot() }));
}
void main().catch((error) => {
  console.error(JSON.stringify({ label: "verification_error", reason: error instanceof Error ? error.name : "UNKNOWN" }));
  process.exitCode = 1;
});
