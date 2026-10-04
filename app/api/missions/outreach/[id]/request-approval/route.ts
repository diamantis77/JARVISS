import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createSupabaseRepositories } from "@/lib/repositories/supabase";
import { MissionService } from "@/lib/missions/service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase || !user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const id = (await params).id;
  const repositories = createSupabaseRepositories(supabase, user.id);
  const connection = await repositories.connections.getGoogle();
  if (!connection || connection.status !== "connected" || !connection.refreshTokenEncrypted || !connection.scopes.includes("https://www.googleapis.com/auth/gmail.compose")) {
    return Response.json({ error: "Gmail sending is disconnected; the draft remains unsent." }, { status: 409 });
  }
  const lookup = await supabase.from("mission_outreach").select("*").eq("id", id).eq("user_id", user.id).eq("status", "draft").maybeSingle();
  if (lookup.error || !lookup.data) return Response.json({ error: "Draft is unavailable or already submitted." }, { status: 409 });
  const target = await supabase.from("mission_targets").select("lead_id,status").eq("id", lookup.data.target_id).eq("user_id", user.id).maybeSingle();
  if (target.error || !target.data?.lead_id || target.data.status === "do_not_contact" || target.data.status === "declined") return Response.json({ error: "Target is not contactable." }, { status: 409 });
  const lead = await repositories.leads.getById(target.data.lead_id);
  if (!lead || lead.email?.trim().toLowerCase() !== String(lookup.data.recipient_email).trim().toLowerCase()) return Response.json({ error: "Recipient no longer matches the verified lead." }, { status: 409 });
  const suppressed = await supabase.from("contact_suppressions").select("id").eq("user_id", user.id).eq("normalized_email", lead.email.trim().toLowerCase()).maybeSingle();
  if (suppressed.error || suppressed.data) return Response.json({ error: "Recipient is suppressed or suppression status is unavailable." }, { status: 409 });
  const claim = await supabase.from("mission_outreach").update({ status: "pending_approval" }).eq("id", id).eq("user_id", user.id).eq("status", "draft").select("id").maybeSingle();
  if (claim.error || !claim.data) return Response.json({ error: "Draft was already submitted." }, { status: 409 });
  let approvalCreated = false;
  try {
    const draft = await repositories.interactions.create({
      leadId: lead.id, direction: "outbound", channel: "email", subject: lookup.data.subject,
      content: lookup.data.body, status: "draft", provider: "google", providerThreadId: null,
      providerMessageId: null, recipientEmail: lead.email, metadata: { missionOutreachId: id, payloadHash: lookup.data.payload_hash, sendingAccount: connection.providerEmail },
    });
    const run = await repositories.runs.createRun(`Owner review of mission outreach ${id}`);
    const approval = await repositories.approvals.create({
      runId: run.id, actionType: "send_email", recipient: lead.email, subject: lookup.data.subject, preview: lookup.data.body,
      payload: { toolName: "send_email", missionOutreachId: id, input: { draftId: draft.id, recipient: lead.email, subject: lookup.data.subject, body: lookup.data.body, accountEmail: connection.providerEmail, threadId: null, inReplyTo: null } },
    });
    approvalCreated = true;
    await repositories.runs.updateRun(run.id, { status: "waiting_for_approval", summary: "Mission outreach awaits exact-payload owner approval." });
    const linked = await supabase.from("mission_outreach").update({ draft_interaction_id: draft.id, approval_id: approval.id }).eq("id", id).eq("user_id", user.id).eq("status", "pending_approval");
    if (linked.error) throw new Error("Unable to link outreach approval");
    await new MissionService(supabase, user.id).recordEvent(lookup.data.mission_id, `outreach-approval:${id}`, "MISSION_OUTREACH_APPROVAL_REQUESTED", "NORMAL", { outreachId: id, approvalId: approval.id });
    return Response.json({ approvalId: approval.id, message: "Review the exact email in Approvals. Nothing has been sent." });
  } catch {
    if (!approvalCreated) await supabase.from("mission_outreach").update({ status: "draft" }).eq("id", id).eq("user_id", user.id).eq("status", "pending_approval").is("approval_id", null);
    return Response.json({ error: "Unable to prepare approval. No email was sent." }, { status: 503 });
  }
}
