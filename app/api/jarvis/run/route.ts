import { commandSchema, voiceCommandSchema } from "@/lib/validation";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { DemoJarvisProvider } from "@/lib/ai/demo-provider";
import { RouterJarvisProvider } from "@/lib/ai/router-provider";
import { hasAnyAiProvider } from "@/lib/ai/routing-config";
import { runJarvisLoop } from "@/lib/jarvis/tool-loop";
import { checkSharedRateLimit } from "@/lib/security/distributed-rate-limit";
import { createResearchService } from "@/lib/research/factory";

export async function POST(request: Request) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  const rate = await checkSharedRateLimit(context.mode, `jarvis:${context.userId}`);
  if (!rate.allowed) return Response.json({ error: "JARVIS is receiving too many commands. Please wait a moment." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  const raw = await request.json().catch(() => null);
  const voiceParsed = raw && typeof raw === "object" && "source" in raw ? voiceCommandSchema.safeParse(raw) : null;
  const commandParsed = voiceParsed ? null : commandSchema.safeParse(raw);
  if (voiceParsed && !voiceParsed.success || commandParsed && !commandParsed.success) return Response.json({ error: "Enter a command between 2 and 1000 characters." }, { status: 400 });
  const voice = voiceParsed?.success ? voiceParsed.data : null;
  const command = voice?.command ?? (commandParsed?.success ? commandParsed.data.command : "");
  if (voice) {
    const session = await context.repositories.voice.getSession(voice.voiceSessionId);
    if (!session || session.status !== "active") return Response.json({ error: "Voice session is not active. Text mode is still available." }, { status: 409 });
    const duplicate = (await context.repositories.voice.listTranscripts(session.id)).some((item) => item.commandId === voice.voiceCommandId && item.role === "user");
    if (duplicate) return Response.json({ error: "This voice command was already processed." }, { status: 409 });
  }

  const aiMode = context.mode === "demo" ? "demo" : hasAnyAiProvider() ? "routed" : "unavailable";
  const provider = context.mode === "live" ? new RouterJarvisProvider() : new DemoJarvisProvider();
  const researchService = createResearchService(context.repositories, context.mode, context.userId);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      void runJarvisLoop({ command, mode: context.mode, repositories: context.repositories, provider, researchService, inputSource: voice ? "voice" : "text", voiceSessionId: voice?.voiceSessionId, voiceCommandId: voice?.voiceCommandId, voiceConversationContext: voice?.voiceContext, onEvent: (event) => { controller.enqueue(encoder.encode(`${JSON.stringify({ ...event, mode: context.mode, aiMode })}\n`)); } })
        .then(() => undefined)
        .catch(() => controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: "Δεν μπόρεσα να ολοκληρώσω το αίτημα." })}\n`)))
        .finally(() => controller.close());
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
