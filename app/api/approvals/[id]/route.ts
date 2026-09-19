import { approvalDecisionSchema, approvalEditSchema } from "@/lib/validation";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { executeTool } from "@/lib/tools/execute";
import { isToolName, toolRegistry } from "@/lib/tools/registry";
import { log } from "@/lib/logger";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Your session has expired." }, { status: 401 });
  const parsed = approvalDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid approval decision." }, { status: 400 });
  const approval = await context.repositories.approvals.getById((await params).id);
  if (!approval || approval.status !== "pending") return Response.json({ error: "This approval is no longer pending." }, { status: 409 });
  if (parsed.data.decision === "rejected") {
    const resolved = await context.repositories.approvals.resolve(approval.id, "rejected");
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
  const result = await executeTool(toolName, input, { approved: true, context: { repositories: context.repositories, mode: context.mode } });
  const resolved = await context.repositories.approvals.recordExecution(approval.id, result.ok ? result.value : undefined, result.ok ? undefined : result.reason);
  const message = result.ok ? (toolName === "send_email" && "sent" in result.value && !result.value.sent ? "Approved, but no email was sent because the email provider is not connected." : "Approved action executed and recorded.") : "The approved action failed safely. No unverified success was recorded.";
  const stepId = typeof approval.payload?.stepId === "string" ? approval.payload.stepId : null;
  if (stepId) await context.repositories.runs.updateStep(stepId, { status: result.ok ? "completed" : "failed", description: message, output: result.ok ? result.value : undefined, error: result.ok ? undefined : result.reason });
  await context.repositories.runs.updateRun(approval.runId, { status: result.ok ? "completed" : "failed", summary: message });
  const run = await context.repositories.runs.getRun(approval.runId);
  await context.repositories.activity.create({ eventType: "system", title: result.ok ? "Approval executed" : "Approved action failed", description: approval.subject, metadata: { approvalId: approval.id, toolName } });
  log(result.ok ? "approval_approved" : "tool_failed", { approvalId: approval.id, runId: approval.runId, toolName });
  return Response.json({ approval: resolved, run, message, result });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Your session has expired." }, { status: 401 });
  const parsed = approvalEditSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Subject and preview are required." }, { status: 400 });
  try { return Response.json({ approval: await context.repositories.approvals.edit((await params).id, parsed.data), message: "Approval draft updated. Review it again before approving." }); }
  catch { return Response.json({ error: "This approval is no longer editable." }, { status: 409 }); }
}
