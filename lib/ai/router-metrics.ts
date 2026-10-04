import { allProviders, isFreeOpenRouterModel, modelFor } from "./routing-config";
import type { AiFailureReason, AiProviderName } from "./router-types";

interface ProviderCounters {
  day: string; requestCount: number; successCount: number; errorCount: number; rateLimitHits: number;
  timeouts: number; fallbackCount: number; latencyTotalMs: number; consecutiveFailures: number;
  lastSuccess: string | null; lastFailure: string | null; lastError: AiFailureReason | null; cooldownUntil: number;
}
const state = new Map<AiProviderName, ProviderCounters>();
/** Clears process-local counters; used by isolated router tests. */
export function resetAiProviderMetrics() { state.clear(); }
function localDay() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function entry(name: AiProviderName) {
  let item = state.get(name);
  const day = localDay();
  if (!item || item.day !== day) {
    item = { day, requestCount: 0, successCount: 0, errorCount: 0, rateLimitHits: 0, timeouts: 0, fallbackCount: 0,
      latencyTotalMs: 0, consecutiveFailures: 0, lastSuccess: item?.lastSuccess ?? null, lastFailure: item?.lastFailure ?? null,
      lastError: item?.lastError ?? null, cooldownUntil: item?.cooldownUntil ?? 0 };
    state.set(name, item);
  }
  return item;
}
export function providerCoolingDown(name: AiProviderName) { return entry(name).cooldownUntil > Date.now(); }
export function recordAttempt(name: AiProviderName, success: boolean, latencyMs: number, reason?: AiFailureReason, fallback = false) {
  const item = entry(name); item.requestCount++; item.latencyTotalMs += latencyMs; if (fallback) item.fallbackCount++;
  if (success) { item.successCount++; item.consecutiveFailures = 0; item.cooldownUntil = 0; item.lastSuccess = new Date().toISOString(); item.lastError = null; return; }
  item.errorCount++; item.consecutiveFailures++; item.lastFailure = new Date().toISOString(); item.lastError = reason ?? "UNKNOWN";
  if (reason === "RATE_LIMIT") item.rateLimitHits++;
  if (reason === "TIMEOUT") item.timeouts++;
  if (["RATE_LIMIT", "TIMEOUT", "NETWORK", "PROVIDER_ERROR", "EMPTY_OUTPUT"].includes(reason ?? "") && item.consecutiveFailures >= 3) item.cooldownUntil = Date.now() + 60_000;
  if (reason === "AUTH") item.cooldownUntil = Date.now() + 5 * 60_000;
}
export function aiProviderSnapshot() {
  return allProviders.map((provider) => {
    const item = entry(provider);
    const configured = Boolean(process.env[provider === "openrouter" ? "OPENROUTER_API_KEY" : `${provider.toUpperCase()}_API_KEY`]);
    const enabled = provider === "openai" ? process.env.AI_ALLOW_PAID_FALLBACK !== "false" :
      provider === "openrouter" ? isFreeOpenRouterModel(modelFor(provider)) : true;
    return { provider, configured, enabled,
      healthy: configured && enabled && item.cooldownUntil <= Date.now() && item.lastError !== "AUTH",
      model: modelFor(provider), requestsToday: item.requestCount, successfulRequests: item.successCount,
      errors: item.errorCount, rateLimitHits: item.rateLimitHits, timeouts: item.timeouts, fallbacks: item.fallbackCount,
      averageLatencyMs: item.requestCount ? Math.round(item.latencyTotalMs / item.requestCount) : null,
      lastSuccess: item.lastSuccess, lastFailure: item.lastFailure, lastError: item.lastError,
      cooldownUntil: item.cooldownUntil > Date.now() ? new Date(item.cooldownUntil).toISOString() : null };
  });
}
