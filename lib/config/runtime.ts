export type RuntimeMode = "demo" | "live";

export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}

export function getRuntimeMode(): RuntimeMode {
  return getSupabaseConfig() ? "live" : "demo";
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function isVoiceEnabled(mode: RuntimeMode): boolean {
  return mode === "live" && process.env.VOICE_ENABLED === "true" && isOpenAiConfigured();
}

export function getResearchMode(mode: RuntimeMode): "demo" | "live" | "disabled" {
  if (mode === "demo") return "demo";
  return process.env.LIVE_RESEARCH_ENABLED === "true" && isOpenAiConfigured() && process.env.AI_ALLOW_PAID_FALLBACK !== "false" ? "live" : "disabled";
}
