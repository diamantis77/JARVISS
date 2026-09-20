import { describe, expect, it } from "vitest";
import { isExplicitVoiceApprovalSafe, nextVoiceState } from "../lib/voice/state-machine";

describe("voice state machine", () => {
  it("covers connect, speech, response, barge-in, and recovery", () => {
    let state = nextVoiceState("idle", "REQUEST_START");
    state = nextVoiceState(state, "MIC_GRANTED");
    state = nextVoiceState(state, "CONNECTED");
    state = nextVoiceState(state, "USER_AUDIO");
    state = nextVoiceState(state, "UTTERANCE_FINAL");
    state = nextVoiceState(state, "JARVIS_AUDIO");
    expect(state).toBe("jarvis_speaking");
    state = nextVoiceState(state, "BARGE_IN");
    expect(state).toBe("interrupted");
    expect(nextVoiceState(state, "USER_AUDIO")).toBe("user_speaking");
  });

  it("never treats a generic yes as an unbound or ambiguous approval", () => {
    expect(isExplicitVoiceApprovalSafe(["approval-1"], null, "yes")).toBe(false);
    expect(isExplicitVoiceApprovalSafe(["approval-1", "approval-2"], "approval-1", "ναι")).toBe(false);
    expect(isExplicitVoiceApprovalSafe(["approval-1"], "approval-1", "yes")).toBe(true);
    expect(isExplicitVoiceApprovalSafe(["approval-1"], "approval-1", "yes, and email everyone")).toBe(false);
  });

  it("disconnects and allows a controlled retry after failure", () => {
    expect(nextVoiceState("listening", "DISCONNECT")).toBe("disconnected");
    expect(nextVoiceState("connecting", "FAIL")).toBe("error");
    expect(nextVoiceState("error", "REQUEST_START")).toBe("requesting_microphone");
  });
});
