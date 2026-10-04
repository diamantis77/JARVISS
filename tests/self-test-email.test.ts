import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiTurnRequest, AiTurnResult, JarvisAiProvider } from "../lib/ai/provider";
import { selfTestEmailBlockReason } from "../lib/email/self-test";
import { runJarvisLoop } from "../lib/jarvis/tool-loop";
import { createDemoRepositories } from "../lib/repositories/demo";
import { executeTool } from "../lib/tools/execute";

class QueueProvider implements JarvisAiProvider {
  constructor(private readonly turns: AiTurnResult[]) {}
  async respond(_request: AiTurnRequest) { const next = this.turns.shift(); if (!next) throw new Error("Missing mocked turn"); return next; }
}
const turn = (text: string, toolCalls: AiTurnResult["toolCalls"] = []): AiTurnResult => ({ responseId: crypto.randomUUID(), text, toolCalls });
const input = { recipient: "owner@example.com", accountEmail: "owner@example.com", subject: "Δοκιμή JARVIS", body: "Αυτό είναι ένα δοκιμαστικό μήνυμα." };

async function connectedRepositories() {
  const repositories = createDemoRepositories();
  await repositories.connections.upsertGoogle({ provider: "google", providerAccountId: "owner", providerEmail: "owner@example.com", status: "connected",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"], accessTokenEncrypted: "test", refreshTokenEncrypted: "test", tokenExpiresAt: null, lastSyncAt: null, errorCode: null, errorMessage: null });
  return repositories;
}

afterEach(() => vi.unstubAllEnvs());

describe("owner-only Gmail self-test", () => {
  it("only accepts the connected inbox in Live Mode", async () => {
    vi.stubEnv("GOOGLE_GMAIL_ENABLED", "true");
    const repositories = await connectedRepositories();
    expect(await selfTestEmailBlockReason(repositories, "live", input.recipient, input.accountEmail)).toBeNull();
    expect(await selfTestEmailBlockReason(repositories, "live", "other@example.com", input.accountEmail)).toContain("μόνο");
    expect(await selfTestEmailBlockReason(repositories, "demo", input.recipient, input.accountEmail)).toContain("Demo Mode");
  });

  it("prepares an exact-payload approval but never sends before UI approval", async () => {
    vi.stubEnv("GOOGLE_GMAIL_ENABLED", "true");
    const repositories = await connectedRepositories();
    const provider = new QueueProvider([turn("", [{ callId: "self_test", name: "send_self_test_email", arguments: JSON.stringify(input) }])]);
    const result = await runJarvisLoop({ command: "Στείλε ένα δοκιμαστικό email στο συνδεδεμένο μου Gmail", mode: "live", repositories, provider, inputSource: "voice" });
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.approval?.actionType).toBe("send_email");
    expect(result.approval?.payload?.input).toEqual(input);
    expect(result.message).toContain("Είναι σωστός ο παραλήπτης;");
    expect(result.message).toContain("Δεν έχει σταλεί ακόμη");
  });

  it("rejects another recipient before creating an approval", async () => {
    vi.stubEnv("GOOGLE_GMAIL_ENABLED", "true");
    const repositories = await connectedRepositories();
    const provider = new QueueProvider([turn("", [{ callId: "self_test", name: "send_self_test_email", arguments: JSON.stringify({ ...input, recipient: "other@example.com" }) }]), turn("Η δοκιμή επιτρέπεται μόνο στο συνδεδεμένο Gmail.")]);
    const result = await runJarvisLoop({ command: "Στείλε σε άλλη διεύθυνση", mode: "live", repositories, provider });
    expect(result.run.status).toBe("completed");
    expect(result.run.steps.some((step) => step.toolName === "send_self_test_email" && step.status === "failed")).toBe(true);
    expect((await repositories.approvals.getPending()).some((approval) => approval.payload?.toolName === "send_self_test_email")).toBe(false);
  });

  it("never invokes Gmail without approval even for the connected inbox", async () => {
    vi.stubEnv("GOOGLE_GMAIL_ENABLED", "true");
    const repositories = await connectedRepositories();
    const sendMessage = vi.fn(async () => ({ messageId: "provider-message", threadId: "provider-thread" }));
    const result = await executeTool("send_self_test_email", input, { context: { repositories, mode: "live", workspace: { email: { sendMessage } as never, calendar: {} as never } } });
    expect(result).toMatchObject({ ok: false, reason: "Approval required" });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
