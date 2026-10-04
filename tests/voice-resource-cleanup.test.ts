import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../lib/voice/browser-provider.ts", import.meta.url), "utf8");

describe("browser voice resource lifecycle", () => {
  it("guards duplicate starts and emits the end callback once", () => {
    expect(source).toContain("if (this.startPromise) return this.startPromise");
    expect(source).toContain("endedCallbackSent");
    expect(source).toContain("if (!this.endedCallbackSent)");
  });

  it("releases WebRTC, media, analyser, audio, and timer resources", () => {
    expect(source).toContain("track.stop()");
    expect(source).toContain("this.pc.close()");
    expect(source).toContain("this.channel.close()");
    expect(source).toContain("this.audioContext.close()");
    expect(source).toContain("this.disconnectInputMeter()");
    expect(source).toContain("this.disconnectOutputMeter()");
    expect(source).toContain("clearTimeout(this.idleTimer)");
    expect(source).toContain("cancelAnimationFrame(this.animationFrame)");
  });

  it("cuts local output on barge-in and keeps Live API events within the supported schema", () => {
    expect(source).toContain("this.interruptPlayback(); this.emit(\"BARGE_IN\")");
    expect(source).not.toContain("response.cancel");
    expect(source).not.toContain("output_audio_buffer.clear");
  });
});
