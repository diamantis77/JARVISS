import { afterEach, beforeEach, describe, expect, it } from "vitest";
import twilio from "twilio";
import { canPlacePhoneCall, DEFAULT_PHONE_SETTINGS, isWithinPhoneWindow } from "../lib/telephony/policy";
import { createMediaToken, validateMediaToken, validateTwilioFormRequest } from "../lib/telephony/security";
import { getTelephonyStatus } from "../lib/telephony/config";
import { mayApplyPhoneStatus, normalizeTwilioCallStatus } from "../lib/telephony/status";

const original = { ...process.env };
beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
  process.env.TWILIO_PHONE_NUMBER = "+15550000001";
  process.env.JARVIS_OWNER_PHONE_NUMBER = "+15550000002";
  process.env.PUBLIC_TELEPHONY_BASE_URL = "https://jarvis.example.test";
});
afterEach(() => { process.env = { ...original }; });

describe("telephony policy", () => {
  it("defaults to opt-out and blocks a call", () => {
    expect(DEFAULT_PHONE_SETTINGS.enabled).toBe(false);
    expect(canPlacePhoneCall(DEFAULT_PHONE_SETTINGS, "UTC", false, new Date("2026-09-22T12:00:00Z")).allowed).toBe(false);
    expect(Object.entries(DEFAULT_PHONE_SETTINGS).filter(([key, value]) => /Brief|Reply|meeting|Failure|Deal|Event/i.test(key) && value === true)).toHaveLength(0);
  });

  it("enforces local calling hours and urgent-only exceptions", () => {
    const settings = { ...DEFAULT_PHONE_SETTINGS, enabled: true, outsideHours: "urgent_only" as const };
    expect(isWithinPhoneWindow(settings, "UTC", new Date("2026-09-22T10:00:00Z"))).toBe(true);
    expect(canPlacePhoneCall(settings, "UTC", false, new Date("2026-09-22T02:00:00Z")).allowed).toBe(false);
    expect(canPlacePhoneCall(settings, "UTC", true, new Date("2026-09-22T02:00:00Z")).allowed).toBe(true);
  });

  it("allows only a verified customer reply to bypass hours when explicitly enabled", () => {
    const night = new Date("2026-09-22T02:00:00Z");
    const settings = { ...DEFAULT_PHONE_SETTINGS, enabled: true, importantCustomerReply: true, customerReplyOutsideHours: true };
    expect(canPlacePhoneCall(settings, "UTC", false, night, true).allowed).toBe(true);
    expect(canPlacePhoneCall(settings, "UTC", false, night).allowed).toBe(false);
    expect(canPlacePhoneCall({ ...settings, importantCustomerReply: false }, "UTC", false, night, true).allowed).toBe(false);
    expect(canPlacePhoneCall({ ...settings, customerReplyOutsideHours: false }, "UTC", false, night, true).allowed).toBe(false);
    expect(canPlacePhoneCall({ ...settings, enabled: false }, "UTC", false, night, true).allowed).toBe(false);
  });
});

describe("telephony security", () => {
  it("uses an expiring, call-bound media token", () => {
    const token = createMediaToken("call-a");
    expect(validateMediaToken("call-a", token)).toBe(true);
    expect(validateMediaToken("call-b", token)).toBe(false);
  });

  it("validates a form webhook against the configured public URL", async () => {
    const url = "https://jarvis.example.test/api/telephony/twilio/status?callId=call-a";
    const params = { CallSid: "CA_test", CallStatus: "ringing" };
    const signature = twilio.getExpectedTwilioSignature("test_auth_token", url, params);
    const request = new Request("http://127.0.0.1:3000/api/telephony/twilio/status?callId=call-a", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": signature }, body: new URLSearchParams(params) });
    const result = await validateTwilioFormRequest(request, "/api/telephony/twilio/status");
    expect(result.valid).toBe(true);
  });

  it("rejects an invalid Twilio signature", async () => {
    const request = new Request("http://127.0.0.1:3000/api/telephony/twilio/status?callId=call-a", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "invalid" }, body: new URLSearchParams({ CallSid: "CA_test" }) });
    expect((await validateTwilioFormRequest(request, "/api/telephony/twilio/status")).valid).toBe(false);
  });

  it("never reports ready without a public HTTPS endpoint", () => {
    process.env.PUBLIC_TELEPHONY_BASE_URL = "http://127.0.0.1:3000";
    expect(getTelephonyStatus().readiness).toBe("public_endpoint_missing");
    process.env.PUBLIC_TELEPHONY_BASE_URL = "https://localhost:3000";
    expect(getTelephonyStatus().readiness).toBe("public_endpoint_missing");
  });
});

describe("provider status transitions", () => {
  it("normalizes failure states and prevents a late ringing event from reopening a terminal call", () => {
    expect(normalizeTwilioCallStatus("no-answer")).toBe("no_answer");
    expect(normalizeTwilioCallStatus("in-progress")).toBe("in_progress");
    expect(mayApplyPhoneStatus("completed", "ringing")).toBe(false);
    expect(mayApplyPhoneStatus("completed", "completed")).toBe(true);
  });
});
