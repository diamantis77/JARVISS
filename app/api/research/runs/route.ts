import { createRequestRepositories } from "@/lib/repositories/factory";

export async function GET() {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Authentication required." }, { status: 401 });
  const runs = await context.repositories.research.listRecent(10);
  return Response.json({ runs }, { headers: { "Cache-Control": "private, no-store" } });
}
