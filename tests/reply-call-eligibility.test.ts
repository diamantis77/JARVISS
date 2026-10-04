import { describe, expect, it } from "vitest";
import { isHumanCustomerReply, isVerifiedCustomerReply } from "../lib/google/reply-call-eligibility";

describe("customer reply call eligibility", () => {
  it("allows a human customer but rejects self-mail and automated mail", () => {
    expect(isHumanCustomerReply([], "customer@example.test", "owner@example.test")).toBe(true);
    expect(isHumanCustomerReply([], "owner@example.test", "owner@example.test")).toBe(false);
    expect(isHumanCustomerReply([], "customer@example.test", null)).toBe(false);
    expect(isHumanCustomerReply([], "no-reply@example.test", "owner@example.test")).toBe(false);
    expect(isHumanCustomerReply([{ name: "Auto-Submitted", value: "auto-replied" }], "customer@example.test", "owner@example.test")).toBe(false);
    expect(isHumanCustomerReply([{ name: "Precedence", value: "bulk" }], "customer@example.test", "owner@example.test")).toBe(false);
    expect(isHumanCustomerReply([{ name: "List-Id", value: "list.example" }], "customer@example.test", "owner@example.test")).toBe(false);
  });

  it("requires a real sent-thread match and a new message", () => {
    const base = { humanSender: true, duplicateInteraction: false, sentThreadMatched: true, missionThreadMatched: false, duplicateMissionReply: false, receivedAt: "2026-09-22T02:00:00Z", now: new Date("2026-09-22T02:10:00Z").getTime() };
    expect(isVerifiedCustomerReply(base)).toBe(true);
    expect(isVerifiedCustomerReply({ ...base, sentThreadMatched: false })).toBe(false);
    expect(isVerifiedCustomerReply({ ...base, duplicateInteraction: true })).toBe(false);
    expect(isVerifiedCustomerReply({ ...base, humanSender: false })).toBe(false);
    expect(isVerifiedCustomerReply({ ...base, sentThreadMatched: false, missionThreadMatched: true })).toBe(true);
    expect(isVerifiedCustomerReply({ ...base, sentThreadMatched: false, missionThreadMatched: true, duplicateMissionReply: true })).toBe(false);
    expect(isVerifiedCustomerReply({ ...base, now: new Date("2026-09-22T03:00:00Z").getTime() })).toBe(false);
  });
});
