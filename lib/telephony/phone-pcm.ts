export const VONAGE_PCM_RATE = 16_000;
export const PCM_SAMPLE_BYTES = 2;
export const OUTPUT_FRAME_MS = 20;
export const OUTPUT_FRAME_BYTES = VONAGE_PCM_RATE * PCM_SAMPLE_BYTES * OUTPUT_FRAME_MS / 1_000;

export function inspectPcm16Le(input: Buffer) {
  let clippedSamples = 0; let peak = 0;
  for (let offset = 0; offset + 1 < input.length; offset += 2) {
    const amplitude = Math.abs(input.readInt16LE(offset));
    peak = Math.max(peak, amplitude);
    if (amplitude >= 32_760) clippedSamples += 1;
  }
  return { clippedSamples, peak };
}

// A bounded, paced local queue keeps provider playback close to real time and
// lets barge-in discard audio that has not yet reached the provider socket.
export class PacedPcmOutput {
  private pending = Buffer.alloc(0);
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private lastSentAt: number | null = null;
  readonly stats = { sentPackets: 0, sentBytes: 0, droppedBytes: 0, maxQueuedBytes: 0 };

  constructor(private readonly sendFrame: (frame: Buffer) => void, private readonly now = Date.now) {}

  enqueue(pcm: Buffer) {
    if (this.closed || !pcm.length) return;
    this.pending = Buffer.concat([this.pending, pcm]);
    // Five seconds is a hard safety limit, not a normal operating target.
    const maxBytes = OUTPUT_FRAME_BYTES * 250;
    if (this.pending.length > maxBytes) {
      const discard = this.pending.length - maxBytes;
      const alignedDiscard = discard + (discard % 2);
      this.pending = Buffer.from(this.pending.subarray(alignedDiscard));
      this.stats.droppedBytes += alignedDiscard;
    }
    this.stats.maxQueuedBytes = Math.max(this.stats.maxQueuedBytes, this.pending.length);
    if (!this.timer) this.drain();
  }

  private drain() {
    this.timer = null;
    if (this.closed || this.pending.length < 2) return;
    const length = Math.min(OUTPUT_FRAME_BYTES, this.pending.length - (this.pending.length % 2));
    const frame = Buffer.from(this.pending.subarray(0, length));
    this.pending = Buffer.from(this.pending.subarray(length));
    this.sendFrame(frame);
    this.lastSentAt = this.now();
    this.stats.sentPackets += 1; this.stats.sentBytes += frame.length;
    if (this.pending.length >= 2) this.timer = setTimeout(() => this.drain(), OUTPUT_FRAME_MS);
  }

  clear() {
    const discardedBytes = this.pending.length;
    this.pending = Buffer.alloc(0);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return { clearedAt: this.now(), discardedBytes, lastSentAt: this.lastSentAt };
  }

  hasPending() { return this.pending.length > 0 || (this.lastSentAt !== null && this.now() - this.lastSentAt < 800); }
  close() { this.closed = true; this.clear(); }
}

// Compare caller PCM with recently sent provider PCM. This only suppresses a
// bridge-side interruption trigger; all inbound audio still reaches GPT-Live.
export class PcmEchoGuard {
  private recentOutput: number[] = [];
  private readonly decimation = 4;
  private readonly maxSamples = VONAGE_PCM_RATE / this.decimation;

  rememberSent(frame: Buffer) {
    for (let offset = 0; offset + 1 < frame.length; offset += PCM_SAMPLE_BYTES * this.decimation) {
      this.recentOutput.push(frame.readInt16LE(offset));
    }
    if (this.recentOutput.length > this.maxSamples) this.recentOutput.splice(0, this.recentOutput.length - this.maxSamples);
  }

  isLikelyEcho(frame: Buffer) {
    const input: number[] = [];
    let inputPower = 0; let inputSum = 0;
    for (let offset = 0; offset + 1 < frame.length; offset += PCM_SAMPLE_BYTES * this.decimation) {
      const sample = frame.readInt16LE(offset);
      input.push(sample); inputPower += sample * sample; inputSum += sample;
    }
    if (input.length < 24 || inputPower / input.length < 500 * 500 || this.recentOutput.length < input.length) return false;
    const inputMean = inputSum / input.length;
    const inputVariance = inputPower - inputSum * inputMean;
    if (inputVariance / input.length < 120 * 120) return false;
    const lastStart = this.recentOutput.length - input.length;
    for (let start = 0; start <= lastStart; start += 8) {
      let dot = 0; let outputPower = 0; let outputSum = 0;
      for (let index = 0; index < input.length; index += 1) {
        const sample = this.recentOutput[start + index];
        dot += input[index] * sample; outputPower += sample * sample; outputSum += sample;
      }
      const centeredDot = dot - inputSum * outputSum / input.length;
      const outputVariance = outputPower - outputSum * outputSum / input.length;
      if (outputVariance > 0 && centeredDot * centeredDot > 0.72 * 0.72 * inputVariance * outputVariance) return true;
    }
    return false;
  }
}
