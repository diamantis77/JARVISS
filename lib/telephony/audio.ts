function clamp16(value: number) { return Math.max(-32768, Math.min(32767, Math.round(value))); }

export function resamplePcm16Le(input: Buffer, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return Buffer.from(input);
  const sourceLength = Math.floor(input.length / 2);
  if (!sourceLength) return Buffer.alloc(0);
  const targetLength = Math.max(1, Math.round(sourceLength * targetRate / sourceRate));
  const output = Buffer.allocUnsafe(targetLength * 2);
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * sourceRate / targetRate;
    const left = Math.min(sourceLength - 1, Math.floor(sourcePosition));
    const right = Math.min(sourceLength - 1, left + 1);
    const weight = sourcePosition - left;
    const sample = input.readInt16LE(left * 2) * (1 - weight) + input.readInt16LE(right * 2) * weight;
    output.writeInt16LE(clamp16(sample), index * 2);
  }
  return output;
}

export function pcm16Level(input: Buffer) {
  const count = Math.floor(input.length / 2);
  if (!count) return 0;
  let sum = 0;
  for (let index = 0; index < count; index += 1) { const sample = input.readInt16LE(index * 2); sum += sample * sample; }
  return Math.sqrt(sum / count);
}
