import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { MissionService } from "@/lib/missions/service";

const ruleSchema = z.object({ priority: z.enum(["HIGH", "URGENT"]), phoneEnabled: z.boolean(), cooldownMinutes: z.number().int().min(5).max(1440).default(120) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase || !user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const parsed = ruleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid mission notification rule" }, { status: 400 });
  const missionId = (await params).id;
  try {
    const mission = await new MissionService(supabase, user.id).get(missionId);
    if (!mission || mission.status === "stopped") return Response.json({ error: "Mission is unavailable or stopped." }, { status: 404 });
    if (mission.outreachPolicy.researchOnly === true && parsed.data.phoneEnabled) return Response.json({ error: "Phone notifications are disabled for research-only missions." }, { status: 403 });
    const row = { mission_id: missionId, user_id: user.id, priority: parsed.data.priority, dashboard_enabled: true, phone_enabled: parsed.data.phoneEnabled, cooldown_minutes: parsed.data.cooldownMinutes };
    const { data, error } = await supabase.from("mission_notification_rules").upsert(row, { onConflict: "mission_id,priority" }).select("priority,dashboard_enabled,phone_enabled,cooldown_minutes").single();
    if (error) throw new Error("Unable to update mission notification rule");
    return Response.json({ rule: data, deploymentEnabled: process.env.MISSION_PHONE_NOTIFICATIONS_ENABLED === "true" });
  } catch {
    return Response.json({ error: "Mission notification rule could not be saved." }, { status: 503 });
  }
}
