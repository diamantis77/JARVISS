import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { MissionService } from "@/lib/missions/service";

const actionSchema = z.object({ status: z.enum(["active", "paused", "stopped"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase || !user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid mission action" }, { status: 400 });
  try {
    const service = new MissionService(supabase, user.id);
    const mission = await service.setStatus((await params).id, parsed.data.status);
    return Response.json({ mission });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "Stopped missions cannot be resumed" ? error.message : "Mission update failed" }, { status: 409 });
  }
}
