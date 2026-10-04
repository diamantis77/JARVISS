import type { SupabaseClient } from "@supabase/supabase-js";
import { MissionService } from "./service";

export async function recordMissionOutreachDecision(db: SupabaseClient, userId: string, approvalId: string, outcome: "rejected" | "sent" | "blocked", providerMessageId?: string | null, providerThreadId?: string | null) {
  const lookup = await db.from("mission_outreach").select("id,mission_id,target_id,status").eq("user_id", userId).eq("approval_id", approvalId).maybeSingle();
  if (lookup.error) throw new Error("Unable to read mission outreach decision");
  if (!lookup.data || lookup.data.status !== "pending_approval") return;
  const patch = outcome === "sent"
    ? { status: "sent", sent_at: new Date().toISOString(), provider_message_id: providerMessageId ?? null, provider_thread_id: providerThreadId ?? null }
    : { status: outcome };
  const changed = await db.from("mission_outreach").update(patch).eq("id", lookup.data.id).eq("user_id", userId).eq("status", "pending_approval").select("id").maybeSingle();
  if (changed.error) throw new Error("Unable to record mission outreach decision");
  if (!changed.data) return;
  if (outcome === "sent") {
    const target = await db.from("mission_targets").update({ status: "contacted" }).eq("id", lookup.data.target_id).eq("user_id", userId).eq("status", "qualified");
    if (target.error) throw new Error("Unable to update contacted target");
  }
  await new MissionService(db, userId).recordEvent(lookup.data.mission_id, `outreach-result:${lookup.data.id}`, `MISSION_OUTREACH_${outcome.toUpperCase()}`, outcome === "sent" ? "NORMAL" : "LOW", { outreachId: lookup.data.id });
}
