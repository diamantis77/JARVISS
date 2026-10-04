import { describe, expect, it } from "vitest";
import { shouldProtectPath } from "../lib/security/auth-routing";

describe("authenticated route protection", () => {
  it("protects application and API routes in live mode", () => { expect(shouldProtectPath("/", true)).toBe(true); expect(shouldProtectPath("/api/jarvis/run", true)).toBe(true); });
  it("keeps auth routes public and demo mode accessible", () => { expect(shouldProtectPath("/auth/sign-in", true)).toBe(false); expect(shouldProtectPath("/leads", false)).toBe(false); });
  it("allows only signed provider callback routes through middleware", () => { expect(shouldProtectPath("/api/telephony/twilio/voice", true)).toBe(false); expect(shouldProtectPath("/api/telephony/twilio/status", true)).toBe(false); expect(shouldProtectPath("/api/telephony/vonage/answer", true)).toBe(false); expect(shouldProtectPath("/api/telephony/vonage/event", true)).toBe(false); expect(shouldProtectPath("/api/telephony/status", true)).toBe(true); });
});
