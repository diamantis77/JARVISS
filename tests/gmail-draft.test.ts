import { afterEach, describe, expect, it, vi } from "vitest";
import { google } from "googleapis";
import { createDemoRepositories } from "../lib/repositories/demo";
import { GoogleGmailProvider } from "../lib/workspace/google";
import { GOOGLE_GMAIL_SCOPES, hasCapability } from "../lib/google/scopes";

vi.mock("../lib/google/oauth", () => ({ authorizedGoogleClient: vi.fn(async () => ({ auth: {} })) }));

afterEach(() => vi.restoreAllMocks());

describe("Gmail draft boundary", () => {
  it("requires read and compose but never broad mailbox permission", () => {
    expect(GOOGLE_GMAIL_SCOPES).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ]);
    expect(hasCapability([...GOOGLE_GMAIL_SCOPES], "gmail")).toBe(true);
    expect(hasCapability(["https://www.googleapis.com/auth/gmail.send"], "gmail")).toBe(false);
  });

  it("creates a Gmail draft without invoking send and preserves reply headers", async () => {
    const create = vi.fn(async (_input: { requestBody: { message: { raw: string } } }) => ({ data: { id: "draft-provider-1", message: { id: "message-1", threadId: "thread-1" } } }));
    const send = vi.fn();
    vi.spyOn(google, "gmail").mockReturnValue({ users: { drafts: { create }, messages: { send } } } as never);
    const provider = new GoogleGmailProvider(createDemoRepositories());
    const result = await provider.createDraft({ to: "owner@example.com", subject: "Δοκιμή", body: "Χωρίς αποστολή.", threadId: "thread-1", inReplyTo: "<old@example.com>" });
    expect(result).toEqual({ draftId: "draft-provider-1", messageId: "message-1", threadId: "thread-1" });
    const raw = create.mock.calls[0]?.[0]?.requestBody?.message?.raw;
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: owner@example.com");
    expect(decoded).toContain("In-Reply-To: <old@example.com>");
    expect(decoded).toContain("Χωρίς αποστολή.");
    expect(send).not.toHaveBeenCalled();
  });
});
