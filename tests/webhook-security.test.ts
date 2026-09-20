import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validatePubSubClaims, verifyPubSubRequest } from "../lib/google/pubsub-auth";
import { calendarTokenHash, validCalendarChannel } from "../lib/google/calendar-webhook";

describe("production webhook security", () => {
  beforeEach(() => { process.env.GOOGLE_PUBSUB_EXPECTED_AUDIENCE = "https://jarvis.example/api/webhooks/google/gmail"; process.env.GOOGLE_PUBSUB_ALLOWED_SERVICE_ACCOUNT = "pubsub-push@example.iam.gserviceaccount.com"; });
  afterEach(() => { delete process.env.GOOGLE_PUBSUB_EXPECTED_AUDIENCE; delete process.env.GOOGLE_PUBSUB_ALLOWED_SERVICE_ACCOUNT; });
  const valid = { aud: "https://jarvis.example/api/webhooks/google/gmail", email: "pubsub-push@example.iam.gserviceaccount.com", email_verified: true, exp: 2_000_000_000, iss: "https://accounts.google.com", sub: "123" };
  it("rejects an invalid signed Pub/Sub JWT", async () => { const verifier = { async verifyIdToken() { throw new Error("invalid signature"); } }; const request = new Request("https://jarvis.example/webhook", { headers: { authorization: "Bearer invalid.jwt.value" } }); await expect(verifyPubSubRequest(request, verifier)).rejects.toThrow("invalid signature"); });
  it("rejects wrong audience, expiry and unknown service identity", () => { expect(() => validatePubSubClaims({ ...valid, aud: "wrong" }, valid.aud, valid.email!, 1_900_000_000)).toThrow("audience"); expect(() => validatePubSubClaims({ ...valid, exp: 1 }, valid.aud, valid.email!, 2)).toThrow("Expired"); expect(() => validatePubSubClaims({ ...valid, email: "attacker@example.com" }, valid.aud, valid.email!, 1_900_000_000)).toThrow("service account"); });
  it("rejects an invalid Calendar channel token or resource", () => { const persisted = { channelId: "channel-1", resourceId: "resource-1", verificationTokenHash: calendarTokenHash("correct"), status: "active" }; expect(validCalendarChannel({ channel: "channel-1", resource: "resource-1", token: "wrong", messageNumber: "1" }, persisted)).toBe(false); expect(validCalendarChannel({ channel: "channel-1", resource: "wrong", token: "correct", messageNumber: "1" }, persisted)).toBe(false); expect(validCalendarChannel({ channel: "channel-1", resource: "resource-1", token: "correct", messageNumber: "1" }, persisted)).toBe(true); });
});
