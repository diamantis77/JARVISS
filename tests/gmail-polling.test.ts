import { describe, expect, it } from "vitest";
import { gmailPollKey } from "../lib/jobs/scheduler";

const scope = ["https://www.googleapis.com/auth/gmail.readonly"];
const now = new Date("2026-10-04T00:11:20Z");

describe("Gmail reply polling fallback", () => {
  it("polls in deduplicated five-minute windows when push is not configured", () => {
    const first = gmailPollKey("connection-a", scope, null, undefined, now);
    expect(first).toBe("gmail-poll:connection-a:5970242");
    expect(gmailPollKey("connection-a", scope, null, undefined, new Date("2026-10-04T00:14:59Z"))).toBe(first);
    expect(gmailPollKey("connection-a", scope, null, undefined, new Date("2026-10-04T00:15:00Z"))).not.toBe(first);
  });

  it("does not poll when a valid push watch is active", () => {
    expect(gmailPollKey("connection-a", scope, "2026-10-04T01:00:00Z", "projects/example/topics/gmail", now)).toBeNull();
    expect(gmailPollKey("connection-a", scope, null, "projects/example/topics/gmail", now)).not.toBeNull();
  });

  it("never polls a connection without Gmail read scope", () => {
    expect(gmailPollKey("connection-a", [], null, undefined, now)).toBeNull();
  });
});
