import { createRequestRepositories } from "@/lib/repositories/factory";
import { createResearchService } from "@/lib/research/factory";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Your session has expired." }, { status: 401 });
  const researchRun = await context.repositories.research.getRun((await params).id);
  if (!researchRun) return Response.json({ error: "Research run not found." }, { status: 404 });
  if (!researchRun.jarvisRunId) return Response.json({ error: "Research run has no JARVIS run." }, { status: 409 });
  const jarvisRun = await context.repositories.runs.getRun(researchRun.jarvisRunId);
  if (!jarvisRun) return Response.json({ error: "JARVIS run not found." }, { status: 404 });
  const service = createResearchService(context.repositories, context.mode);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const order = jarvisRun.currentStep + 1;
      const step = await context.repositories.runs.addStep(jarvisRun.id, { order, title: "Research batch", description: "Resuming persisted research.", status: "running", toolName: "continue_research", input: { researchRunId: researchRun.id } });
      await context.repositories.runs.updateRun(jarvisRun.id, { currentStep: order, status: "running" });
      const emit = async (description: string, metadata?: Record<string, unknown>) => { await context.repositories.runs.updateStep(step.id, { status: "running", description, output: metadata }); const run = await context.repositories.runs.getRun(jarvisRun.id); if (run) controller.enqueue(encoder.encode(`${JSON.stringify({ type: "step", run, mode: context.mode })}\n`)); };
      try {
        const result = await service.continue({ researchRunId: researchRun.id, onProgress: (progress) => emit(progress.description, { processed: progress.processed, total: progress.total, researchRunId: researchRun.id }) });
        await context.repositories.runs.updateStep(step.id, { status: result.status === "failed" ? "failed" : "completed", description: result.message, output: result });
        await context.repositories.runs.updateRun(jarvisRun.id, { status: result.status === "partial" ? "running" : result.status === "cancelled" ? "cancelled" : result.status === "failed" ? "failed" : "completed", summary: result.message, context: { ...(jarvisRun.context ?? {}), researchRunId: result.researchRunId, researchStatus: result.status, researchProcessed: result.processedCount, researchTotal: result.discoveredCount } });
        const run = await context.repositories.runs.getRun(jarvisRun.id);
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: result.status === "partial" ? "step" : "complete", run, message: result.message, research: result, mode: context.mode })}\n`));
      } catch { controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: "Research batch could not continue safely." })}\n`)); }
      finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
