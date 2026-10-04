import { approvalDecisionSchema, approvalEditSchema } from "@/lib/validation";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { executeTool } from "@/lib/tools/execute";
import { isToolName, toolRegistry } from "@/lib/tools/registry";
import { log } from "@/lib/logger";
import { createWorkspaceProviders } from "@/lib/workspace/factory";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { recordMissionOutreachDecision } from "@/lib/missions/approval";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Your session has expired." }, { status: 401 });
  const parsed = approvalDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid approval decision." }, { status: 400 });
  const approval = await context.repositories.approvals.getById((await params).id);
  if (!approval || approval.status !== "pending") return Response.json({ error: "This approval is no longer pending." }, { status: 409 });
  if (parsed.data.decision === "rejected") {
    const resolved = await context.repositories.approvals.resolve(approval.id, "rejected");
    if (typeof approval.payload?.missionOutreachId === "string" && context.mode === "live") {
      const { supabase, user } = await getAuthenticatedUser();
      if (supabase && user) await recordMissionOutreachDecision(supabase, user.id, approval.id, "rejected");
    }
    const stepId = typeof approval.payload?.stepId === "string" ? approval.payload.stepId : null;
    if (stepId) await context.repositories.runs.updateStep(stepId, { status: "completed", description: "The proposed action was rejected. Nothing was executed." });
    await context.repositories.runs.updateRun(approval.runId, { status: "completed", summary: "The action was rejected. Nothing external was executed." });
    const run = await context.repositories.runs.getRun(approval.runId);
    await context.repositories.activity.create({ eventType: "system", title: "Approval rejected", description: approval.subject, metadata: { approvalId: approval.id } });
    log("approval_rejected", { approvalId: approval.id, runId: approval.runId });
    return Response.json({ approval: resolved, run, message: "Action rejected. Nothing external was executed." });
  }
  const toolName = typeof approval.payload?.toolName === "string" ? approval.payload.toolName : "";
  const input = approval.payload?.input;
  if (!isToolName(toolName) || toolRegistry[toolName].permission !== "REQUIRES_USER_APPROVAL" || !toolRegistry[toolName].input.safeParse(input).success) {
    return Response.json({ error: "The approval payload is stale or invalid. No action was executed." }, { status: 409 });
  }
  try { await context.repositories.approvals.claimForExecution(approval.id); }
  catch { return Response.json({ error: "This approval was already resolved. No duplicate action was executed." }, { status: 409 }); }
  const result = await executeTool(toolName, input, { approved: true, context: { repositories: context.repositories, mode: context.mode, workspace: createWorkspaceProviders(context.repositories, context.mode) } });
  const noEmailSent = result.ok && typeof result.value === "object" && result.value !== null && "sent" in result.value && result.value.sent === false;
  const noEmailReason = noEmailSent && "reason" in result.value && typeof result.value.reason === "string" ? result.value.reason : "Δεν στάλθηκε email.";
  const executed = result.ok && !noEmailSent;
  const resolved = await context.repositories.approvals.recordExecution(approval.id, executed ? result.value : undefined, executed ? undefined : noEmailSent ? noEmailReason : result.reason);
  if (typeof approval.payload?.missionOutreachId === "string" && context.mode === "live") {
    const { supabase, user } = await getAuthenticatedUser();
    if (supabase && user) {
      const value = result.ok ? result.value as { sent?: boolean; messageId?: string; threadId?: string } : null;
      await recordMissionOutreachDecision(supabase, user.id, approval.id, value?.sent ? "sent" : "blocked", value?.messageId ?? null, value?.threadId ?? null);
    }
  }
  const emailSent = executed && (toolName === "send_email" || toolName === "send_self_test_email") && "sent" in result.value && result.value.sent === true;
  const message = noEmailSent ? `Δεν στάλθηκε email: ${noEmailReason}` : emailSent ? "Το email στάλθηκε και καταγράφηκε." : executed ? "Η εγκεκριμένη ενέργεια εκτελέστηκε και καταγράφηκε." : "Η εγκεκριμένη ενέργεια απέτυχε με ασφάλεια. Δεν καταγράφηκε ανεπιβεβαίωτη επιτυχία.";
  const stepId = typeof approval.payload?.stepId === "string" ? approval.payload.stepId : null;
  if (stepId) await context.repositories.runs.updateStep(stepId, { status: executed ? "completed" : "failed", description: message, output: executed ? result.value : undefined, error: executed ? undefined : noEmailSent ? noEmailReason : result.reason });
  await context.repositories.runs.updateRun(approval.runId, { status: executed ? "completed" : "failed", summary: message });
  const run = await context.repositories.runs.getRun(approval.runId);
  await context.repositories.activity.create({ eventType: "system", title: executed ? "Approval executed" : "Approved action failed", description: approval.subject, metadata: { approvalId: approval.id, toolName } });
  log(executed ? "approval_approved" : "tool_failed", { approvalId: approval.id, runId: approval.runId, toolName });
  return Response.json({ approval: resolved, run, message, result });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Your session has expired." }, { status: 401 });
  const parsed = approvalEditSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Subject and preview are required." }, { status: 400 });
  const existing = await context.repositories.approvals.getById((await params).id);
  if (existing?.actionType === "send_email") return Response.json({ error: "Το email είναι κλειδωμένο σε ακριβές προσχέδιο. Απόρριψέ το και ετοίμασε νέο για αλλαγές." }, { status: 409 });
  try { return Response.json({ approval: await context.repositories.approvals.edit((await params).id, parsed.data), message: "Approval draft updated. Review it again before approving." }); }
  catch { return Response.json({ error: "This approval is no longer editable." }, { status: 409 }); }
}
