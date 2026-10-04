import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserMicrophoneMeter } from "../lib/voice/browser-audio";
import { BrowserLocalWakeWordProvider } from "../lib/voice/browser-wake-word-provider";

class FakeRecognition {
  static instance: FakeRecognition | null = null;
  static async available() { return "available"; }
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  lang = "";
  processLocally = false;
  startedTrack: MediaStreamTrack | undefined;
  stopCount = 0;
  onstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { FakeRecognition.instance = this; }
  start(track?: MediaStreamTrack) { this.startedTrack = track; this.onstart?.(); }
  stop() { this.stopCount += 1; this.onend?.(); }
  abort() { this.onend?.(); }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeRecognition.instance = null;
});

describe("local browser wake recognition", () => {
  it("uses the metered track and waits for a result after speech ends", async () => {
    const track = { kind: "audio", readyState: "live" } as MediaStreamTrack;
    vi.stubGlobal("window", { isSecureContext: true, SpeechRecognition: FakeRecognition, setTimeout, clearTimeout });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn() } });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(BrowserMicrophoneMeter.prototype, "start").mockResolvedValue({ getAudioTracks: () => [track] } as unknown as MediaStream);
    vi.spyOn(BrowserMicrophoneMeter.prototype, "stop").mockResolvedValue(undefined);
    const detected = vi.fn();
    const provider = new BrowserLocalWakeWordProvider({ onState: vi.fn(), onDetected: detected });

    await provider.start({ phrase: "Hey Jarvis", language: "el-GR" });
    const recognition = FakeRecognition.instance;
    expect(recognition).not.toBeNull();
    expect(recognition?.startedTrack).toBe(track);
    expect(recognition?.continuous).toBe(true);
    expect(recognition?.processLocally).toBe(true);

    recognition?.onspeechstart?.();
    recognition?.onspeechend?.();
    expect(recognition?.stopCount).toBe(0);
    recognition?.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, length: 1, 0: { transcript: "Hey Jarvis", confidence: .9 } }],
    });
    await new Promise((resolve) => setTimeout(resolve, 230));
    expect(detected).toHaveBeenCalledOnce();
    expect(detected).toHaveBeenCalledWith("Hey Jarvis", .9);
    await provider.stop();
  });
});
