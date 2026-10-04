import type { SupabaseClient } from "@supabase/supabase-js";
import { MissionService } from "./service";

export type MissionReplyClassification = "INTERESTED" | "QUESTION" | "MEETING_REQUEST" | "NOT_INTERESTED" | "UNSUBSCRIBE" | "UNCLEAR";

export function classifyMissionReply(_subject: string, snippet: string): MissionReplyClassification {
  // A "Re: ..." subject often repeats our own outbound subject; intent must
  // come from the actual incoming text, never from an old conversation title.
  const text = snippet.toLocaleLowerCase("el-GR");
  if (/\b(unsubscribe|remove me|do not contact)\b|διαγραφ[ήη]|μην (μου )?(ξανα)?στείλ|μην επικοινων/i.test(text)) return "UNSUBSCRIBE";
  if (/\b(not interested|no thanks|not for us)\b|δεν (με|μας) ενδιαφέρ|δεν επιθυμ/i.test(text)) return "NOT_INTERESTED";
  if (/\b(schedule a meeting|book a call|set up a call)\b|να (κλείσουμε|κανονίσουμε) (ένα )?(ραντεβού|συνάντηση)|θέλω (ένα )?ραντεβού/i.test(text)) return "MEETING_REQUEST";
  if (/\b(i am interested|we are interested|sounds interesting)\b|ενδιαφέρομαι|μας ενδιαφέρει|με ενδιαφέρει/i.test(text)) return "INTERESTED";
  if (/[?;;]|\b(how much|what is|can you|could you)\b|πόσο|πώς|μπορείτε/i.test(text)) return "QUESTION";
  return "UNCLEAR";
}

export async function recordMissionReply(db: SupabaseClient, input: { userId: string; threadId: string; providerMessageId: string; senderEmail: string; subject: string; snippet: string; receivedAt: string; suppressPhoneNotification?: boolean }) {
  if (!input.threadId || !input.providerMessageId) return { matched: false };
  const email = input.senderEmail.trim().toLowerCase();
  const outreach = await db.from("mission_outreach").select("id,mission_id,target_id,recipient_email,status")
    .eq("user_id", input.userId).eq("provider_thread_id", input.threadId).eq("status", "sent").eq("recipient_email", email).maybeSingle();
  if (outreach.error && ["42P01", "PGRST205"].includes(outreach.error.code ?? "")) return { matched: false, schemaUnavailable: true };
  if (outreach.error) throw new Error("Unable to correlate mission reply");
  if (!outreach.data) return { matched: false };
  const classification = classifyMissionReply(input.subject, input.snippet);
  const inserted = await db.from("mission_replies").upsert({ user_id: input.userId, outreach_id: outreach.data.id, provider_message_id: input.providerMessageId, classification, received_at: input.receivedAt }, { onConflict: "user_id,provider_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (inserted.error) throw new Error("Unable to record mission reply");
  if (!inserted.data) return { matched: true, duplicate: true, classification };
  const existingSuppression = await db.from("contact_suppressions").select("id")
    .eq("user_id", input.userId).eq("normalized_email", email).maybeSingle();
  if (existingSuppression.error) throw new Error("Unable to verify contact suppression");
  // A later positive-looking reply must not silently undo an owner's or
  // recipient's do-not-contact decision. Store the reply for audit only.
  if (existingSuppression.data && classification !== "UNSUBSCRIBE" && classification !== "NOT_INTERESTED") {
    await new MissionService(db, input.userId).recordEvent(outreach.data.mission_id, `reply:${input.providerMessageId}`, "MISSION_REPLY_SUPPRESSED", "LOW", { replyId: inserted.data.id, classification, outreachId: outreach.data.id });
    return { matched: true, duplicate: false, classification, suppressed: true };
  }
  if (classification === "UNSUBSCRIBE" || classification === "NOT_INTERESTED") {
    const status = classification === "UNSUBSCRIBE" ? "do_not_contact" : "declined";
    const target = await db.from("mission_targets").update({ status }).eq("id", outreach.data.target_id).eq("user_id", input.userId);
    if (target.error) throw new Error("Unable to update opted-out target");
    const suppression = await db.from("contact_suppressions").upsert({ user_id: input.userId, normalized_email: email, reason: classification === "UNSUBSCRIBE" ? "unsubscribe" : "declined", source_key: `mission-reply:${input.providerMessageId}` }, { onConflict: "user_id,normalized_email", ignoreDuplicates: true });
    if (suppression.error) throw new Error("Unable to preserve contact suppression");
  } else if (classification === "INTERESTED" || classification === "MEETING_REQUEST") {
    const target = await db.from("mission_targets").update({ status: classification === "MEETING_REQUEST" ? "meeting" : "interested" }).eq("id", outreach.data.target_id).eq("user_id", input.userId).in("status", ["contacted", "replied", "qualified"]);
    if (target.error) throw new Error("Unable to update interested target");
    const opportunity = await db.from("mission_opportunities").upsert({ user_id: input.userId, mission_id: outreach.data.mission_id, target_id: outreach.data.target_id, status: classification === "MEETING_REQUEST" ? "meeting_requested" : "open" }, { onConflict: "target_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (opportunity.error) throw new Error("Unable to save mission opportunity");
    if (classification === "MEETING_REQUEST") {
      const advanced = await db.from("mission_opportunities").update({ status: "meeting_requested" })
        .eq("user_id", input.userId).eq("target_id", outreach.data.target_id).eq("status", "open");
      if (advanced.error) throw new Error("Unable to advance mission opportunity");
      const existing = opportunity.data ?? (await db.from("mission_opportunities").select("id").eq("user_id", input.userId).eq("target_id", outreach.data.target_id).single()).data;
      if (existing?.id) {
        const targetRecord = await db.from("mission_targets").select("lead_id").eq("id", outreach.data.target_id).eq("user_id", input.userId).single();
        if (targetRecord.error) throw new Error("Unable to read appointment lead");
        const leadRecord = targetRecord.data?.lead_id ? await db.from("leads").select("business_name").eq("id", targetRecord.data.lead_id).eq("user_id", input.userId).maybeSingle() : null;
        if (leadRecord?.error) throw new Error("Unable to read appointment business");
        const appointment = await db.from("mission_appointments").upsert({ user_id: input.userId, opportunity_id: existing.id, source_reply_id: inserted.data.id,
          business_name: leadRecord?.data?.business_name ?? null, source_email: email,
          context_text: "Meeting requested in a correlated Gmail reply; time not yet confirmed.", status: "requested", requested_at: input.receivedAt }, { onConflict: "source_reply_id", ignoreDuplicates: true });
        if (appointment.error) throw new Error("Unable to save requested appointment");
      }
    }
  } else {
    const target = await db.from("mission_targets").update({ status: "replied" }).eq("id", outreach.data.target_id).eq("user_id", input.userId).eq("status", "contacted");
    if (target.error) throw new Error("Unable to mark replied target");
  }
  const priority = classification === "INTERESTED" || classification === "MEETING_REQUEST" ? "HIGH" : classification === "UNSUBSCRIBE" ? "NORMAL" : "LOW";
  await new MissionService(db, input.userId).recordEvent(outreach.data.mission_id, `reply:${input.providerMessageId}`, "MISSION_REPLY_RECEIVED", priority, { replyId: inserted.data.id, classification, outreachId: outreach.data.id }, undefined, input.suppressPhoneNotification === true);
  return { matched: true, duplicate: false, classification };
}
