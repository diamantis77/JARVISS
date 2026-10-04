import { describe, expect, it, vi } from "vitest";

const createRequestRepositories = vi.hoisted(() => vi.fn());
vi.mock("../lib/repositories/factory", () => ({ createRequestRepositories }));
vi.mock("@/lib/repositories/factory", () => ({ createRequestRepositories }));
import { GET } from "../app/api/operations/ai-providers/route";
import { recordAttempt, resetAiProviderMetrics } from "../lib/ai/router-metrics";

describe("AI provider health API", () => {
  it("requires authentication and never returns configured credentials", async () => {
    createRequestRepositories.mockResolvedValueOnce(null).mockResolvedValueOnce({ mode: "live" });
    expect((await GET()).status).toBe(401);
    vi.stubEnv("GROQ_API_KEY", "private-test-value-do-not-expose");
    const response = await GET();
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('"configured":true');
    expect(body).not.toContain("private-test-value-do-not-expose");
    vi.unstubAllEnvs();
  });
  it("returns sanitized live counters, fallback latency, and model to an authenticated viewer", async () => {
    resetAiProviderMetrics();
    createRequestRepositories.mockResolvedValueOnce({ mode: "live" });
    recordAttempt("groq", false, 420, "RATE_LIMIT");
    recordAttempt("gemini", true, 810, undefined, true);
    const response = await GET();
    const body = await response.json();
    const groq = body.providers.find((item: { provider: string }) => item.provider === "groq");
    const gemini = body.providers.find((item: { provider: string }) => item.provider === "gemini");
    expect(response.status).toBe(200);
    expect(groq).toMatchObject({ requestsToday: 1, errors: 1, rateLimitHits: 1, averageLatencyMs: 420 });
    expect(gemini).toMatchObject({ requestsToday: 1, successfulRequests: 1, fallbacks: 1, averageLatencyMs: 810 });
    expect(typeof gemini.model).toBe("string");
    resetAiProviderMetrics();
  });
});
