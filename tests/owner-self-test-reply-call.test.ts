import { describe, expect, it } from "vitest";
import { isEligibleOwnerSelfTestReply } from "../lib/google/self-test-reply-call";

const arm = {
  id: "arm-1",
  occurred_at: "2026-10-04T10:00:00Z",
  payload: {
    providerMessageId: "sent-message-1",
    providerThreadId: "thread-1",
    sentAt: "2026-10-04T09:00:00Z",
    expiresAt: "2026-10-05T10:00:00Z",
  },
};
const reply = {
  arm,
  sender: "owner@example.test",
  connectedAddress: "owner@example.test",
  messageId: "reply-message-1",
  threadId: "thread-1",
  receivedAt: "2026-10-04T10:01:00Z",
  now: new Date("2026-10-04T10:02:00Z").getTime(),
};

describe("one-time owner self-test reply eligibility", () => {
  it("accepts only a fresh reply in the armed sent thread", () => {
    expect(isEligibleOwnerSelfTestReply(reply)).toBe(true);
    expect(isEligibleOwnerSelfTestReply({ ...reply, messageId: "sent-message-1" })).toBe(false);
    expect(isEligibleOwnerSelfTestReply({ ...reply, threadId: "another-thread" })).toBe(false);
    expect(isEligibleOwnerSelfTestReply({ ...reply, sender: "stranger@example.test" })).toBe(false);
  });

  it("rejects old replies, pre-authorization replies and expired arms", () => {
    expect(isEligibleOwnerSelfTestReply({ ...reply, receivedAt: "2026-10-04T09:59:00Z" })).toBe(false);
    expect(isEligibleOwnerSelfTestReply({ ...reply, now: new Date("2026-10-04T11:00:00Z").getTime() })).toBe(false);
    expect(isEligibleOwnerSelfTestReply({ ...reply, now: new Date("2026-10-05T10:00:00Z").getTime() })).toBe(false);
  });
});
