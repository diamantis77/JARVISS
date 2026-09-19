import { createRequestRepositories } from "@/lib/repositories/factory";
import { createResearchService } from "@/lib/research/factory";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Your session has expired." }, { status: 401 });
  const researchRun = await context.repositories.research.getRun((await params).id);
  if (!researchRun) return Response.json({ error: "Research run not found." }, { status: 404 });
  await createResearchService(context.repositories, context.mode).cancel(researchRun.id);
  let run = researchRun.jarvisRunId ? await context.repositories.runs.getRun(researchRun.jarvisRunId) : null;
  if (run) run = await context.repositories.runs.updateRun(run.id, { status: "cancelled", summary: "Research cancelled. Completed evidence was preserved.", context: { ...(run.context ?? {}), researchRunId: researchRun.id, researchStatus: "cancelled" } });
  return Response.json({ cancelled: true, run, message: "Research cancelled. Completed evidence was preserved." });
}
