import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity, Approval, JarvisRun, JarvisRunStep, Lead, Task } from "../../../types";

export class RepositoryError extends Error {
  constructor(public readonly operation: string) { super(`Repository operation failed: ${operation}`); }
}

export function assertResult<T>(data: T | null, error: { message: string } | null, operation: string): T {
  if (error || data === null) throw new RepositoryError(operation);
  return data;
}

export function mapLead(row: Record<string, unknown>): Lead {
  return {
    id: String(row.id), businessName: String(row.business_name), category: String(row.category ?? "Unknown"), city: String(row.city ?? "Unknown"), country: String(row.country ?? "Unknown"),
    website: row.website ? String(row.website) : null, email: row.email ? String(row.email) : null, phone: row.phone ? String(row.phone) : null,
    source: row.source === "demo" ? "demo" : "provider", status: row.status as Lead["status"], score: Number(row.score ?? 0), scoreReason: String(row.score_reason ?? "Unknown"),
    opportunitySummary: String(row.opportunity_summary ?? "Unknown"), reviewCount: row.review_count === null || row.review_count === undefined ? null : Number(row.review_count), lastActivity: String(row.updated_at ?? row.created_at ?? "Unknown"),
  };
}

export function mapTask(row: Record<string, unknown>): Task {
  return { id: String(row.id), title: String(row.title), leadId: row.lead_id ? String(row.lead_id) : undefined, status: row.status === "completed" ? "completed" : "open", priority: (row.priority as Task["priority"]) ?? "medium", due: row.due_at ? String(row.due_at) : "No due date" };
}

export function mapStep(row: Record<string, unknown>): JarvisRunStep {
  return { id: String(row.id), order: Number(row.step_order), title: String(row.title), description: String(row.description ?? ""), status: row.status as JarvisRunStep["status"], toolName: row.tool_name ? String(row.tool_name) : undefined, result: row.output_json ? JSON.stringify(row.output_json) : undefined, input: row.input_json, output: row.output_json, error: row.error_message ? String(row.error_message) : undefined };
}

export function mapRun(row: Record<string, unknown>, steps: JarvisRunStep[] = []): JarvisRun {
  return { id: String(row.id), request: String(row.request), status: row.status as JarvisRun["status"], summary: String(row.summary ?? ""), currentStep: Number(row.current_step ?? 0), createdAt: String(row.created_at), steps, context: row.context_json && typeof row.context_json === "object" ? row.context_json as Record<string, unknown> : {} };
}

export function mapApproval(row: Record<string, unknown>): Approval {
  const payload = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>;
  const rawAction = String(row.action_type);
  const actionType: Approval["actionType"] = rawAction === "send_email" || rawAction === "book_meeting" ? rawAction : "update_crm";
  return { id: String(row.id), runId: String(row.run_id), actionType, status: row.status as Approval["status"], recipient: String(payload.recipient ?? "Unknown"), subject: String(payload.subject ?? rawAction), preview: String(payload.preview ?? "Review the structured payload before approval."), payload, createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null };
}

export function mapActivity(row: Record<string, unknown>): Activity {
  const known = ["analysis", "score", "outreach", "task", "system"];
  const eventType = known.includes(String(row.event_type)) ? row.event_type as Activity["eventType"] : "system";
  return { id: String(row.id), time: String(row.created_at), eventType, title: String(row.title), description: String(row.description ?? "") };
}

export type DbClient = SupabaseClient;
