import { createRequestRepositories } from "@/lib/repositories/factory";
import { aiProviderSnapshot } from "../../../../lib/ai/router-metrics";

export async function GET() {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
  return Response.json({ providers: aiProviderSnapshot(), scope: "current app process; resets on restart" },
    { headers: { "Cache-Control": "private, no-store" } });
}
