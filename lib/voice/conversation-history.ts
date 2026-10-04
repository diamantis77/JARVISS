export type VoiceHistoryMessage = { role: "user" | "assistant"; text: string };

const MAX_MESSAGES = 8;
const MAX_TEXT_LENGTH = 1200;

// Keep only a small, in-memory text window. Never retain microphone audio.
export function appendVoiceHistory(history: VoiceHistoryMessage[], role: VoiceHistoryMessage["role"], delta: string): VoiceHistoryMessage[] {
  if (!delta) return history;
  const next = history.map((message) => ({ ...message }));
  const last = next.at(-1);
  if (last?.role === role) last.text = (last.text + delta).slice(-MAX_TEXT_LENGTH);
  else next.push({ role, text: delta.slice(-MAX_TEXT_LENGTH) });
  return next.slice(-MAX_MESSAGES);
}

export function normalizeVoiceHistory(value: unknown): VoiceHistoryMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_MESSAGES).flatMap((item) => {
    if (!item || typeof item !== "object" || !["user", "assistant"].includes(item.role) || typeof item.text !== "string") return [];
    const text = item.text.trim().slice(0, MAX_TEXT_LENGTH);
    return text ? [{ role: item.role as VoiceHistoryMessage["role"], text }] : [];
  });
}

export function toLiveSessionInput(history: VoiceHistoryMessage[]) {
  return normalizeVoiceHistory(history).map((message) => message.role === "user"
    ? { type: "message" as const, role: "user" as const, content: [{ type: "input_text" as const, text: message.text }] }
    : { type: "message" as const, role: "assistant" as const, content: [{ type: "output_text" as const, text: message.text }] });
}
