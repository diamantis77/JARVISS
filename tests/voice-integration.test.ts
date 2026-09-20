import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AiTurnRequest, AiTurnResult, JarvisAiProvider } from "../lib/ai/provider";
import { runJarvisLoop } from "../lib/jarvis/tool-loop";
import { createDemoRepositories } from "../lib/repositories/demo";

class QueueProvider implements JarvisAiProvider {
  constructor(private readonly turns: AiTurnResult[]) {}
  async respond(_request: AiTurnRequest) { const turn = this.turns.shift(); if (!turn) throw new Error("No mocked turn"); return turn; }
}
const turn = (text: string, toolCalls: AiTurnResult["toolCalls"] = []): AiTurnResult => ({ responseId: `response_${crypto.randomUUID()}`, text, toolCalls });

describe("voice integration", () => {
  it("uses the same tool loop and persists only final linked turns", async () => {
    const repositories = createDemoRepositories();
    const session = await repositories.voice.createSession({ providerSessionId: "live-test", model: "gpt-live-1", voice: "marin" });
    await repositories.voice.updateSession(session.id, { status: "active" });
    const provider = new QueueProvider([turn("", [{ callId: "call_1", name: "search_crm", arguments: '{"query":"","limit":2}' }]), turn("Βρήκα δύο leads.")]);
    const result = await runJarvisLoop({ command: "Δείξε μου τα καλύτερα leads", mode: "demo", repositories, provider, inputSource: "voice", voiceSessionId: session.id, voiceCommandId: "command-1" });
    const transcripts = await repositories.voice.listTranscripts(session.id);
    expect(result.run.context).toMatchObject({ inputSource: "voice", voiceSessionId: session.id, voiceCommandId: "command-1" });
    expect(result.run.steps.some((step) => step.toolName === "search_crm")).toBe(true);
    expect(transcripts.map((item) => [item.role, item.text])).toEqual([["user", "Δείξε μου τα καλύτερα leads"], ["assistant", "Βρήκα δύο leads."]]);
  });

  it("keeps the existing approval gate authoritative for voice", async () => {
    const repositories = createDemoRepositories();
    const session = await repositories.voice.createSession({ providerSessionId: "live-test", model: "gpt-live-1", voice: "marin" });
    const provider = new QueueProvider([turn("", [{ callId: "send", name: "send_email", arguments: '{"draftId":"d1","recipient":"demo@example.com","subject":"Hello","body":"Draft","threadId":null,"inReplyTo":null}' }])]);
    const result = await runJarvisLoop({ command: "Στείλε το", mode: "demo", repositories, provider, inputSource: "voice", voiceSessionId: session.id, voiceCommandId: "command-2" });
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.approval?.status).toBe("pending");
  });

  it("deduplicates finalized transcript records for reconnect retries", async () => {
    const repositories = createDemoRepositories();
    const session = await repositories.voice.createSession({ providerSessionId: null, model: "gpt-live-1", voice: "marin" });
    const input = { voiceSessionId: session.id, jarvisRunId: null, commandId: "same-event", role: "user" as const, text: "Hello" };
    await repositories.voice.addTranscript(input); await repositories.voice.addTranscript(input);
    expect(await repositories.voice.listTranscripts(session.id)).toHaveLength(1);
  });

  it("contains no server API key access in the browser provider", () => {
    const source = readFileSync(new URL("../lib/voice/browser-provider.ts", import.meta.url), "utf8");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("process.env");
  });

  it("routes Gmail and Calendar voice requests through the existing tool loop", async () => {
    const repositories = createDemoRepositories(); const session = await repositories.voice.createSession({ providerSessionId: "live-test", model: "gpt-live-1", voice: "marin" });
    const provider = new QueueProvider([turn("", [{ callId: "mail", name: "list_email_threads", arguments: '{"maxResults":3}' }, { callId: "calendar", name: "list_calendar_events", arguments: '{"timeMin":"2026-09-20T00:00:00+03:00","timeMax":"2026-09-22T00:00:00+03:00","timezone":"Europe/Athens","maxResults":10}' }]), turn("Έλεγξα τα demo email και το ημερολόγιο.")]);
    const result = await runJarvisLoop({ command: "Έχω σημαντικό email και τι έχω αύριο;", mode: "demo", repositories, provider, inputSource: "voice", voiceSessionId: session.id, voiceCommandId: "workspace-command" });
    expect(result.run.steps.some((step) => step.toolName === "list_email_threads")).toBe(true); expect(result.run.steps.some((step) => step.toolName === "list_calendar_events")).toBe(true);
  });
});
