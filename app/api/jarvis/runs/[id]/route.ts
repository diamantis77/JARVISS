import { createRequestRepositories } from "@/lib/repositories/factory";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const run = await context.repositories.runs.getRun((await params).id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({ run, mode: context.mode }, { headers: { "Cache-Control": "private, no-store" } });
}
