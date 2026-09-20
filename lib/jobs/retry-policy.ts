export type FailureCategory = "rate_limit" | "network" | "provider_5xx" | "credentials" | "permission" | "invalid_payload" | "unknown";
export type FailureDecision = { retryable: boolean; category: FailureCategory; safeSummary: string };

function status(error: unknown) { if (typeof error !== "object" || error === null) return null; const candidate = error as { code?: unknown; status?: unknown; response?: { status?: unknown } }; return Number(candidate.response?.status ?? candidate.status ?? candidate.code) || null; }
export function classifyJobError(error: unknown): FailureDecision {
  const code = status(error); const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (code === 429) return { retryable: true, category: "rate_limit", safeSummary: "Provider rate limit reached; retry scheduled." };
  if (code !== null && code >= 500) return { retryable: true, category: "provider_5xx", safeSummary: "Provider is temporarily unavailable; retry scheduled." };
  if (/timeout|timed out|econnreset|enotfound|network|fetch failed/.test(message)) return { retryable: true, category: "network", safeSummary: "Temporary network failure; retry scheduled." };
  if (code === 401 || /expired|revoked|reconnect|invalid_grant/.test(message)) return { retryable: false, category: "credentials", safeSummary: "Provider authorization requires reconnection." };
  if (code === 403 || /permission|insufficient scope/.test(message)) return { retryable: false, category: "permission", safeSummary: "Provider permission is missing." };
  if (code === 400 || /invalid payload|malformed|validation/.test(message)) return { retryable: false, category: "invalid_payload", safeSummary: "The background operation payload is invalid." };
  return { retryable: true, category: "unknown", safeSummary: "Background operation was temporarily delayed." };
}

const delays = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
export function retryAt(attempt: number, now = Date.now(), random = Math.random) { const base = delays[Math.min(Math.max(attempt - 1, 0), delays.length - 1)]; const jitter = Math.floor(base * 0.2 * random()); return new Date(now + base + jitter).toISOString(); }
