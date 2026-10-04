import { beforeEach, describe, expect, it, vi } from "vitest";

const createCall = vi.fn();
const updateCall = vi.fn();
const fetchCall = vi.fn();
const calls = Object.assign(vi.fn(() => ({ update: updateCall, fetch: fetchCall })), { create: createCall });
vi.mock("twilio", () => ({ default: vi.fn(() => ({ calls })) }));

describe("Twilio provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TWILIO_ACCOUNT_SID = "AC_test";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_PHONE_NUMBER = "+15550000001";
    process.env.JARVIS_OWNER_PHONE_NUMBER = "+15550000002";
    process.env.PUBLIC_TELEPHONY_BASE_URL = "https://jarvis.example.test";
  });

  it("dials only the configured owner and registers signed callback routes", async () => {
    createCall.mockResolvedValue({ sid: "CA_test", status: "queued" });
    const { TwilioTelephonyProvider } = await import("../lib/telephony/twilio-provider");
    const result = await new TwilioTelephonyProvider().createOwnerCall({ phoneCallId: "8a8cf56c-d70f-4583-b5e9-379f10b17a5a", reason: "brief" });
    expect(result).toEqual({ providerCallId: "CA_test", providerStatus: "queued" });
    expect(createCall).toHaveBeenCalledWith(expect.objectContaining({ to: "+15550000002", from: "+15550000001", method: "POST", statusCallbackMethod: "POST" }));
    const request = createCall.mock.calls[0][0];
    expect(request.url).toContain("/api/telephony/twilio/voice?callId=");
    expect(request.statusCallback).toContain("/api/telephony/twilio/status?callId=");
  });
});
