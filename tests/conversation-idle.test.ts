import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserVoiceProvider } from "../lib/voice/browser-provider";
import { conversationIdleDelay, FOLLOW_UP_LISTEN_MS, INITIAL_LISTEN_MS, shouldCloseIdleConversation } from "../lib/voice/conversation-idle";
import type { VoiceSnapshot } from "../lib/voice/contracts";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function idleProvider(state: VoiceSnapshot["state"], awaitingFollowUp: boolean) {
  const provider = new BrowserVoiceProvider({ onState: () => {}, onPartialTranscript: () => {}, onCommand: async () => "", onFinalTurn: () => {}, onConversationEnded: () => {} });
  const internals = provider as unknown as { snapshot: VoiceSnapshot; awaitingFollowUp: boolean; resetIdle(): void };
  internals.snapshot = { ...provider.getState(), state };
  internals.awaitingFollowUp = awaitingFollowUp;
  const stop = vi.fn();
  provider.stopSession = stop;
  return { internals, stop };
}

describe("Siri-like voice conversation lifecycle", () => {
  it("limits initial listening and shortens the post-answer follow-up window", () => {
    expect(conversationIdleDelay("listening", 120_000, false)).toBe(INITIAL_LISTEN_MS);
    expect(conversationIdleDelay("listening", 120_000, true)).toBe(FOLLOW_UP_LISTEN_MS);
    expect(conversationIdleDelay("user_speaking", 120_000, true)).toBe(FOLLOW_UP_LISTEN_MS);
    expect(conversationIdleDelay("interrupted", 120_000, true)).toBe(FOLLOW_UP_LISTEN_MS);
    expect(conversationIdleDelay("listening", 8_000, true)).toBe(8_000);
  });

  it("does not time out an assistant response or an in-flight command", () => {
    expect(conversationIdleDelay("jarvis_speaking", 120_000, true)).toBe(120_000);
    expect(conversationIdleDelay("processing", 120_000, true)).toBe(120_000);
    expect(shouldCloseIdleConversation("jarvis_speaking")).toBe(false);
    expect(shouldCloseIdleConversation("processing")).toBe(false);
  });

  it("closes unattended listening, unfinalized speech, or interruption", () => {
    expect(shouldCloseIdleConversation("listening")).toBe(true);
    expect(shouldCloseIdleConversation("user_speaking")).toBe(true);
    expect(shouldCloseIdleConversation("interrupted")).toBe(true);
  });

  it("ends Live after the follow-up pause, then lets the UI resume local wake", () => {
    vi.useFakeTimers();
    const { internals, stop } = idleProvider("listening", true);
    internals.resetIdle();
    vi.advanceTimersByTime(FOLLOW_UP_LISTEN_MS - 1);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledExactlyOnceWith("idle");
  });

  it("keeps the follow-up window open while the caller is speaking", () => {
    vi.useFakeTimers();
    const { internals, stop } = idleProvider("user_speaking", true);
    internals.resetIdle();
    vi.advanceTimersByTime(10_000);
    internals.resetIdle();
    vi.advanceTimersByTime(10_000);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(stop).toHaveBeenCalledExactlyOnceWith("idle");
  });

  it("does not end while a delegated backend command is still running, even if visual state returns to listening", () => {
    vi.useFakeTimers();
    const { internals, stop } = idleProvider("listening", true);
    const command = internals as typeof internals & { activeCommands: number };
    command.activeCommands = 1;
    internals.resetIdle();
    vi.advanceTimersByTime(FOLLOW_UP_LISTEN_MS * 2);
    expect(stop).not.toHaveBeenCalled();
    command.activeCommands = 0;
    vi.advanceTimersByTime(FOLLOW_UP_LISTEN_MS);
    expect(stop).toHaveBeenCalledExactlyOnceWith("idle");
  });

  it("keeps the conversation open after a non-terminal Live error event", () => {
    vi.useFakeTimers();
    const { internals, stop } = idleProvider("processing", false);
    const live = internals as typeof internals & { stopped: boolean; handleEvent(raw: string): void };
    live.stopped = false;
    live.handleEvent(JSON.stringify({ type: "error", error: { type: "invalid_request_error", code: "command_rejected" } }));
    expect(stop).not.toHaveBeenCalled();
    expect(live.snapshot.state).toBe("processing");
    expect(live.snapshot.error).toBeTruthy();
  });

  it("releases the microphone UI before slow session-end persistence finishes", async () => {
    vi.useFakeTimers();
    let finishRequest!: (response: Response) => void;
    const endRequest = vi.fn(() => new Promise<Response>((resolve) => { finishRequest = resolve; }));
    vi.stubGlobal("fetch", endRequest);
    const ended = vi.fn();
    const provider = new BrowserVoiceProvider({ onState: () => {}, onPartialTranscript: () => {}, onCommand: async () => "", onFinalTurn: () => {}, onConversationEnded: ended });
    const internals = provider as unknown as { stopped: boolean; sessionId: string | null };
    internals.stopped = false;
    internals.sessionId = "research-session";

    const stopping = provider.stopSession("background_work");
    await vi.advanceTimersByTimeAsync(250);
    expect(ended).toHaveBeenCalledExactlyOnceWith("background_work");
    expect(endRequest).toHaveBeenCalledTimes(1);
    finishRequest(new Response(null, { status: 200 }));
    await stopping;
  });
});
