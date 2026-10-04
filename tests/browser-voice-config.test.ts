import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowserLiveVoice } from "../lib/voice/browser-voice-config";

afterEach(() => vi.unstubAllEnvs());

describe("browser voice profile", () => {
  it("defaults to the mature Stone voice and allows Cedar rollback", () => {
    vi.stubEnv("JARVIS_BROWSER_VOICE", undefined);
    expect(getBrowserLiveVoice()).toBe("stone");
    expect(getBrowserLiveVoice("cedar")).toBe("cedar");
  });
  it("does not silently accept unsupported voices", () => {
    expect(() => getBrowserLiveVoice("not-a-voice")).toThrow("Invalid JARVIS_BROWSER_VOICE configuration");
  });
});
