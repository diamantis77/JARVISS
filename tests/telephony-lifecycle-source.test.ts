import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridge = readFileSync("lib/telephony/media-bridge.ts", "utf8");
const sharedBridge = readFileSync("lib/telephony/phone-live-bridge.ts", "utf8");
const calls = readFileSync("lib/telephony/call-owner.ts", "utf8");
const executor = readFileSync("lib/jobs/executor.ts", "utf8");

describe("phone lifecycle invariants", () => {
  it("closes OpenAI, Twilio playback and call-specific timers", () => {
    expect(sharedBridge).toContain('type: "session.close"');
    expect(bridge).toContain('event: "clear"');
    expect(sharedBridge).toContain("clearTimeout(maxTimer)");
    expect(sharedBridge).toContain("phoneSettings.maxCallMinutes * 60_000");
  });

  it("uses the authoritative tool loop and preserves UI approval semantics", () => {
    expect(sharedBridge).toContain("runJarvisLoop");
    expect(sharedBridge).toContain("approval");
    expect(sharedBridge).toContain('inputSource: "phone"');
  });

  it("prevents duplicate provider retries and arbitrary-number input", () => {
    expect(calls).toContain("maxAttempts: 1");
    expect(calls).toContain("deduplicationKey: `dial:${call.id}`");
    expect(executor).toContain("duplicatePrevented: true");
    expect(calls).not.toContain("ownerNumber:");
  });
});
