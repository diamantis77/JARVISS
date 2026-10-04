import { describe, expect, it } from "vitest";
import { isMissingGmailMessage } from "../lib/google/sync";

describe("Gmail history message retrieval", () => {
  it("skips only unavailable 404 messages", () => {
    expect(isMissingGmailMessage({ code: 404 })).toBe(true);
    expect(isMissingGmailMessage({ response: { status: 404 } })).toBe(true);
    expect(isMissingGmailMessage({ code: 403 })).toBe(false);
    expect(isMissingGmailMessage({ response: { status: 429 } })).toBe(false);
    expect(isMissingGmailMessage(new Error("network failure"))).toBe(false);
  });
});
