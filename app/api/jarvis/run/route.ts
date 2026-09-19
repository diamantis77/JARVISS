import { commandSchema } from "@/lib/validation";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { DemoJarvisProvider } from "@/lib/ai/demo-provider";
import { OpenAIJarvisProvider } from "@/lib/ai/openai-provider";
import { isOpenAiConfigured } from "@/lib/config/runtime";
import { runJarvisLoop } from "@/lib/jarvis/tool-loop";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { createResearchService } from "@/lib/research/factory";

export async function POST(request: Request) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  const rate = checkRateLimit(`jarvis:${context.userId}`);
  if (!rate.allowed) return Response.json({ error: "JARVIS is receiving too many commands. Please wait a moment." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  let parsed: ReturnType<typeof commandSchema.safeParse>;
  try { parsed = commandSchema.safeParse(await request.json()); } catch { parsed = commandSchema.safeParse({}); }
  if (!parsed.success) return Response.json({ error: "Enter a command between 2 and 1000 characters." }, { status: 400 });

  const aiMode = context.mode === "live" && isOpenAiConfigured() ? "openai" : "demo";
  const provider = aiMode === "openai" ? new OpenAIJarvisProvider() : new DemoJarvisProvider();
  const researchService = createResearchService(context.repositories, context.mode);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      void runJarvisLoop({ command: parsed.data.command, mode: context.mode, repositories: context.repositories, provider, researchService, onEvent: (event) => { controller.enqueue(encoder.encode(`${JSON.stringify({ ...event, mode: context.mode, aiMode })}\n`)); } })
        .catch(() => controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: "JARVIS could not complete this run." })}\n`)))
        .finally(() => controller.close());
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
