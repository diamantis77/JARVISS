import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyJobError, retryAt } from "../lib/jobs/retry-policy";

describe("background failure recovery", () => {
  it("retries 429, 5xx and network timeouts with bounded exponential delays", () => { expect(classifyJobError({ code: 429 }).retryable).toBe(true); expect(classifyJobError({ response: { status: 503 } }).category).toBe("provider_5xx"); expect(classifyJobError(new Error("network timeout")).category).toBe("network"); const start = Date.parse("2026-09-20T00:00:00Z"); expect(retryAt(1, start, () => 0)).toBe("2026-09-20T00:01:00.000Z"); expect(retryAt(4, start, () => 0)).toBe("2026-09-20T01:00:00.000Z"); });
  it("does not retry expired OAuth, revoked OAuth or malformed payloads", () => { expect(classifyJobError(new Error("invalid_grant revoked OAuth")).retryable).toBe(false); expect(classifyJobError({ code: 403 }).category).toBe("permission"); expect(classifyJobError(new Error("Invalid payload: missing owner")).category).toBe("invalid_payload"); });
  it("contains bounded checkpoint recovery without premature persistence", () => { const source = readFileSync(new URL("../lib/google/sync.ts", import.meta.url), "utf8"); expect(source).toContain("googleStatus(error) !== 404"); expect(source).toContain("googleStatus(error) !== 410"); expect(source.indexOf("for (const item of unique)")).toBeLessThan(source.indexOf("upsertSyncState({ connectionId: connection.id, capability: \"gmail\"")); expect(source.indexOf("for (const event of events)")).toBeLessThan(source.indexOf("upsertSyncState({ connectionId: connection.id, capability: \"calendar\"")); });
});
