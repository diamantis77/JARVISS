import { afterEach, describe, expect, it, vi } from "vitest";
import { getPhoneLiveVoice, PHONE_LIVE_VOICES } from "../lib/telephony/phone-voice-config";
import { inspectPcm16Le, OUTPUT_FRAME_BYTES, PacedPcmOutput, PcmEchoGuard } from "../lib/telephony/phone-pcm";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("phone voice and direct 16 kHz PCM", () => {
  it("defaults to stone, permits only supported masculine voices, and rejects invalid configuration", () => {
    expect(getPhoneLiveVoice(undefined)).toBe("stone");
    for (const voice of PHONE_LIVE_VOICES) expect(getPhoneLiveVoice(voice.toUpperCase())).toBe(voice);
    expect(() => getPhoneLiveVoice("alloy")).toThrow("Invalid JARVIS_LIVE_VOICE configuration");
    expect(() => getPhoneLiveVoice("")).toThrow("Invalid JARVIS_LIVE_VOICE configuration");
  });

  it("preserves signed little-endian samples, exact bytes, and 20 ms output pacing", async () => {
    vi.useFakeTimers();
    const sent: Buffer[] = [];
    const output = new PacedPcmOutput((frame) => sent.push(frame));
    const input = Buffer.alloc(OUTPUT_FRAME_BYTES * 3);
    for (let offset = 0; offset < input.length; offset += 2) input.writeInt16LE(offset % 4 ? -2_000 : 2_000, offset);
    output.enqueue(input);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(input.subarray(0, OUTPUT_FRAME_BYTES));
    await vi.advanceTimersByTimeAsync(19);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(20);
    expect(sent).toHaveLength(3);
    expect(Buffer.concat(sent)).toEqual(input);
    expect(output.stats.droppedBytes).toBe(0);
    expect(inspectPcm16Le(Buffer.from([0xff, 0x7f, 0x00, 0x80]))).toEqual({ clippedSamples: 2, peak: 32768 });
    output.close();
  });

  it("clears unsent audio and does not treat constant or unrelated speech as echo", () => {
    const sent: Buffer[] = [];
    const output = new PacedPcmOutput((frame) => sent.push(frame));
    output.enqueue(Buffer.alloc(OUTPUT_FRAME_BYTES * 10, 0x21));
    const result = output.clear();
    expect(sent).toHaveLength(1);
    expect(result.discardedBytes).toBe(OUTPUT_FRAME_BYTES * 9);
    expect(output.stats.sentBytes).toBe(OUTPUT_FRAME_BYTES);
    const echo = new PcmEchoGuard();
    echo.rememberSent(Buffer.alloc(OUTPUT_FRAME_BYTES, 0x21));
    expect(echo.isLikelyEcho(Buffer.alloc(OUTPUT_FRAME_BYTES, 0x21))).toBe(false);
    output.close();
  });
});
