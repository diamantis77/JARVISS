import type { SupabaseClient } from "@supabase/supabase-js";
import { queueOwnerCall } from "../telephony/call-owner";
import { missionPhonePolicy, type MissionPriority } from "./notification-policy";

export async function maybeQueueMissionOwnerNotification(db: SupabaseClient, input: { userId: string; missionId: string; eventId: string; eventType: string; priority: MissionPriority }) {
  // Explicit deployment opt-in, separate from per-mission owner rules and the
  // existing global phone settings. The migration and UI alone cannot call.
  if (process.env.MISSION_PHONE_NOTIFICATIONS_ENABLED !== "true") return { queued: false, reason: "feature_disabled" };
  if (input.priority !== "HIGH" && input.priority !== "URGENT") return { queued: false, reason: "priority_not_phone_eligible" };
  const mission = await db.from("missions").select("outreach_policy_json").eq("id", input.missionId).eq("user_id", input.userId).maybeSingle();
  if (mission.error || !mission.data) throw new Error("Unable to check mission notification policy");
  if (mission.data.outreach_policy_json?.researchOnly === true) return { queued: false, reason: "research_only" };
  const rule = await db.from("mission_notification_rules").select("phone_enabled,cooldown_minutes,last_phone_queued_at")
    .eq("mission_id", input.missionId).eq("user_id", input.userId).eq("priority", input.priority).maybeSingle();
  if (rule.error) throw new Error("Unable to read mission phone notification rule");
  const decision = missionPhonePolicy(input.priority, Boolean(rule.data?.phone_enabled), true, rule.data?.last_phone_queued_at ?? null, Number(rule.data?.cooldown_minutes ?? 120));
  if (!decision.allowed) return { queued: false, reason: decision.reason };
  const reservedEvent = await db.from("mission_events").update({ phone_dispatch_status: "reserved" })
    .eq("id", input.eventId).eq("mission_id", input.missionId).eq("user_id", input.userId)
    .eq("phone_dispatch_status", "not_requested").select("id").maybeSingle();
  if (reservedEvent.error) throw new Error("Unable to reserve mission phone event");
  if (!reservedEvent.data) return { queued: false, reason: "already_processed" };
  const cooldownCutoff = new Date(Date.now() - Number(rule.data?.cooldown_minutes ?? 120) * 60_000).toISOString();
  const reservedCooldown = await db.from("mission_notification_rules").update({ last_phone_queued_at: new Date().toISOString() })
    .eq("mission_id", input.missionId).eq("user_id", input.userId).eq("priority", input.priority).eq("phone_enabled", true)
    .or(`last_phone_queued_at.is.null,last_phone_queued_at.lte.${cooldownCutoff}`).select("mission_id").maybeSingle();
  if (reservedCooldown.error) throw new Error("Unable to reserve mission phone cooldown");
  if (!reservedCooldown.data) {
    await db.from("mission_events").update({ phone_dispatch_status: "blocked" }).eq("id", input.eventId).eq("user_id", input.userId);
    return { queued: false, reason: "cooldown" };
  }
  let queuedCallId: string | null = null;
  try {
    const result = await queueOwnerCall(db, {
      userId: input.userId, reason: "MISSION_IMPORTANT_RESULT",
      context: { eventType: "MISSION_IMPORTANT_RESULT", missionId: input.missionId, missionEventId: input.eventId, missionEventType: input.eventType },
      urgent: input.priority === "URGENT", deduplicationKey: `mission-phone-event:${input.eventId}`, correlationId: input.eventId,
    });
    if (result.queued) queuedCallId = result.call.id;
    const updated = await db.from("mission_events").update({ phone_dispatch_status: result.queued ? "queued" : "blocked", phone_call_id: result.queued ? result.call.id : null })
      .eq("id", input.eventId).eq("user_id", input.userId);
    if (updated.error) throw new Error("Unable to record mission phone dispatch result");
    return { queued: result.queued, reason: result.queued ? null : result.reason };
  } catch {
    // Never retry an ambiguous provider/queue outcome automatically.
    if (queuedCallId) {
      await db.from("mission_events").update({ phone_dispatch_status: "queued", phone_call_id: queuedCallId }).eq("id", input.eventId).eq("user_id", input.userId);
      return { queued: true, reason: "audit_delayed" };
    }
    await db.from("mission_events").update({ phone_dispatch_status: "unknown" }).eq("id", input.eventId).eq("user_id", input.userId);
    return { queued: false, reason: "dispatch_outcome_unknown" };
  }
}
