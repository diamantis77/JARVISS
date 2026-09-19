import type { JarvisAiProvider, AiToolOutput } from "../ai/provider";
import { JARVIS_INSTRUCTIONS_V2 } from "../ai/instructions/v2";
import type { Repositories } from "../repositories/contracts";
import type { RuntimeMode } from "../config/runtime";
import { executeTool } from "../tools/execute";
import { isToolName, openAiTools, toolRegistry } from "../tools/registry";
import { log } from "../logger";
import type { Approval, JarvisRun } from "../../types";
import type { ResearchService } from "../research/contracts";

export type JarvisEvent = { type: "run" | "step" | "approval" | "complete" | "error"; run: JarvisRun; approval?: Approval; message?: string };
interface RunOptions { command: string; mode: RuntimeMode; repositories: Repositories; provider: JarvisAiProvider; researchService?: ResearchService; onEvent?: (event: JarvisEvent) => void | Promise<void> }

function safeParseArguments(raw: string): unknown { try { return JSON.parse(raw); } catch { return null; } }
function approvalAction(toolName: string): Approval["actionType"] { if (toolName === "send_email") return "send_email"; return "update_crm"; }
function approvalPresentation(toolName: string, args: Record<string, unknown>) { return { recipient: typeof args.recipient === "string" ? args.recipient : "CRM record", subject: typeof args.subject === "string" ? args.subject : toolName.replaceAll("_", " "), preview: typeof args.preview === "string" ? args.preview : JSON.stringify(args) }; }

export async function runJarvisLoop({ command, mode, repositories, provider, researchService, onEvent }: RunOptions) {
  let run = await repositories.runs.createRun(command);
  log("run_started", { runId: run.id, mode });
  await onEvent?.({ type: "run", run });
  const understanding = await repositories.runs.addStep(run.id, { order: 1, title: "Understanding request", description: "Validated the command and prepared a constrained execution context.", status: "completed", toolName: "plan_request", output: { accepted: true } });
  run = await repositories.runs.updateRun(run.id, { currentStep: 1 });
  run = (await repositories.runs.getRun(run.id)) ?? { ...run, steps: [understanding] };
  await onEvent?.({ type: "step", run });
  try {
    const settings = await repositories.settings.get();
    const recentRuns = await repositories.runs.listRecentRuns(4);
    const memory = { owner: settings.fullName || "Unknown", business: settings.businessName || "Unknown", services: settings.companyServices, targets: { industries: settings.targetIndustries, locations: settings.targetLocations }, preferredLanguage: settings.defaultLanguage, minimumLeadScore: settings.minimumLeadScore, recentRuns: recentRuns.filter((item) => item.id !== run.id).slice(0, 3).map((item) => ({ request: item.request, summary: item.summary, context: item.context })) };
    let turn = await provider.respond({ instructions: JARVIS_INSTRUCTIONS_V2, input: `Current date: ${new Date().toISOString()}\nRuntime mode: ${mode}. Demo data must be identified as fictional.\nRelevant structured memory: ${JSON.stringify(memory)}\n\nOwner command: ${command}`, tools: openAiTools() });
    let iteration = 0;
    while (turn.toolCalls.length > 0 && iteration < 8) {
      iteration += 1;
      const outputs: AiToolOutput[] = [];
      for (const call of turn.toolCalls) {
        const order = run.currentStep + 1;
        const args = safeParseArguments(call.arguments);
        const tool = isToolName(call.name) ? toolRegistry[call.name] : null;
        const step = await repositories.runs.addStep(run.id, { order, title: tool ? tool.name.replaceAll("_", " ") : "Unknown tool", description: `Executing ${call.name}`, status: "running", toolName: call.name, input: args });
        run = await repositories.runs.updateRun(run.id, { currentStep: order, providerResponseId: turn.responseId });
        run = (await repositories.runs.getRun(run.id)) ?? run;
        await onEvent?.({ type: "step", run });
        if (!tool || args === null) {
          await repositories.runs.updateStep(step.id, { status: "failed", error: "Malformed or unknown tool request" });
          outputs.push({ callId: call.callId, output: JSON.stringify({ error: "Tool request was invalid" }) });
          continue;
        }
        const validation = tool.input.safeParse(args);
        if (!validation.success) {
          await repositories.runs.updateStep(step.id, { status: "failed", error: "Malformed tool arguments" });
          outputs.push({ callId: call.callId, output: JSON.stringify({ error: "Tool arguments failed validation" }) });
          continue;
        }
        if (tool.permission === "REQUIRES_USER_APPROVAL") {
          const presentation = approvalPresentation(call.name, validation.data as Record<string, unknown>);
          const approval = await repositories.approvals.create({ runId: run.id, actionType: approvalAction(call.name), payload: { toolName: call.name, input: validation.data, stepId: step.id }, ...presentation });
          await repositories.runs.updateStep(step.id, { status: "waiting_for_approval", description: "Validated and paused before external or sensitive execution." });
          await repositories.activity.create({ eventType: "system", title: "Approval requested", description: presentation.subject, metadata: { approvalId: approval.id, runId: run.id, toolName: call.name } });
          run = await repositories.runs.updateRun(run.id, { status: "waiting_for_approval", summary: "JARVIS prepared an action and is waiting for your approval." });
          run = (await repositories.runs.getRun(run.id)) ?? run;
          log("approval_requested", { runId: run.id, approvalId: approval.id, toolName: call.name });
          await onEvent?.({ type: "approval", run, approval, message: run.summary });
          return { run, approval, message: run.summary };
        }
        log("tool_called", { runId: run.id, toolName: call.name });
        const result = await executeTool(call.name, validation.data, { context: { repositories, mode, jarvisRunId: run.id, researchService, emitProgress: async (description, metadata) => { await repositories.runs.updateStep(step.id, { status: "running", description, output: metadata }); if (metadata?.researchRunId) run = await repositories.runs.updateRun(run.id, { context: { ...(run.context ?? {}), researchRunId: metadata.researchRunId, researchStatus: metadata.researchStatus, researchProcessed: metadata.processed, researchTotal: metadata.total } }); run = (await repositories.runs.getRun(run.id)) ?? run; await onEvent?.({ type: "step", run }); } } });
        if (result.ok) {
          await repositories.runs.updateStep(step.id, { status: "completed", description: `${call.name} completed.`, output: result.value });
          const value = result.value as Record<string, unknown>;
          const leads = Array.isArray(value.leads) ? value.leads as Array<Record<string, unknown>> : [];
          const nextContext = { ...(run.context ?? {}), lastTool: call.name, strongestLeadId: leads[0]?.id ?? run.context?.strongestLeadId, leadIds: leads.length ? leads.map((lead) => lead.id).slice(0, 10) : run.context?.leadIds, lastTaskId: typeof value.id === "string" && call.name.includes("task") ? value.id : run.context?.lastTaskId, lastDraftId: typeof value.id === "string" && call.name === "draft_outreach" ? value.id : run.context?.lastDraftId, researchRunId: typeof value.researchRunId === "string" && value.researchRunId ? value.researchRunId : run.context?.researchRunId, researchStatus: typeof value.status === "string" && typeof value.researchRunId === "string" ? value.status : run.context?.researchStatus, researchProcessed: typeof value.processedCount === "number" ? value.processedCount : run.context?.researchProcessed, researchTotal: typeof value.discoveredCount === "number" ? value.discoveredCount : run.context?.researchTotal };
          run = await repositories.runs.updateRun(run.id, { context: nextContext });
          log("tool_completed", { runId: run.id, toolName: call.name });
          outputs.push({ callId: call.callId, output: JSON.stringify(result.value) });
        } else {
          await repositories.runs.updateStep(step.id, { status: "failed", error: result.reason });
          log("tool_failed", { runId: run.id, toolName: call.name });
          outputs.push({ callId: call.callId, output: JSON.stringify({ error: result.reason }) });
        }
        run = (await repositories.runs.getRun(run.id)) ?? run;
        await onEvent?.({ type: "step", run });
      }
      turn = await provider.respond({ instructions: JARVIS_INSTRUCTIONS_V2, previousResponseId: turn.responseId, toolOutputs: outputs, tools: openAiTools() });
    }
    if (iteration >= 8 && turn.toolCalls.length) throw new Error("Tool iteration limit reached");
    const message = turn.text.trim() || "JARVIS completed the run without a text response.";
    const researchPending = run.context?.researchStatus === "partial";
    run = await repositories.runs.updateRun(run.id, { status: researchPending ? "running" : "completed", summary: researchPending ? `${message} Research progress is persisted and will continue in the next batch.` : message, providerResponseId: turn.responseId });
    run = (await repositories.runs.getRun(run.id)) ?? run;
    await onEvent?.({ type: "complete", run, message: run.summary });
    return { run, message: run.summary };
  } catch {
    run = await repositories.runs.updateRun(run.id, { status: "failed", summary: "JARVIS could not complete this run. Please try again." });
    run = (await repositories.runs.getRun(run.id)) ?? run;
    await onEvent?.({ type: "error", run, message: run.summary });
    return { run, message: run.summary };
  }
}
