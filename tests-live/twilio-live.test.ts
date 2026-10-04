import { describe, expect, it } from "vitest";
import { TwilioTelephonyProvider } from "../lib/telephony/twilio-provider";

describe.skipIf(process.env.RUN_LIVE_TWILIO_TESTS !== "true")("CHARGEABLE live Twilio outbound call", () => {
  it("creates a real chargeable owner-only call only when explicitly enabled", async () => {
    const provider = new TwilioTelephonyProvider();
    const call = await provider.createOwnerCall({ phoneCallId: crypto.randomUUID(), reason: "Explicit live connectivity test" });
    expect(call.providerCallId).toMatch(/^CA/);
    await provider.endCall(call.providerCallId);
  }, 60_000);
});
