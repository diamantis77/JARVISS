import type { SupabaseClient } from "@supabase/supabase-js";
import type { Activity, Approval, JarvisRun, JarvisRunStep, Lead, LeadEvidence, ResearchCandidate, ResearchRun, ResearchSource, Task, WebsiteAnalysis } from "../../../types";

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
    scoreComponents: Array.isArray(row.score_components) ? row.score_components as Lead["scoreComponents"] : [], evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids.map(String) : [], researchConfidence: (row.research_confidence as Lead["researchConfidence"]) ?? "unknown", lastResearchedAt: row.last_researched_at ? String(row.last_researched_at) : null,
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
  const knownActions: Approval["actionType"][] = ["send_email", "book_meeting", "update_crm", "create_calendar_event", "update_calendar_event", "delete_calendar_event"];
  const actionType: Approval["actionType"] = knownActions.includes(rawAction as Approval["actionType"]) ? rawAction as Approval["actionType"] : "update_crm";
  return { id: String(row.id), runId: String(row.run_id), actionType, status: row.status as Approval["status"], recipient: String(payload.recipient ?? "Unknown"), subject: String(payload.subject ?? rawAction), preview: String(payload.preview ?? "Review the structured payload before approval."), payload, createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null };
}

export function mapActivity(row: Record<string, unknown>): Activity {
  const known = ["analysis", "score", "outreach", "task", "system"];
  const eventType = known.includes(String(row.event_type)) ? row.event_type as Activity["eventType"] : "system";
  return { id: String(row.id), time: String(row.created_at), eventType, title: String(row.title), description: String(row.description ?? "") };
}

export function mapResearchRun(row: Record<string, unknown>): ResearchRun { return { id: String(row.id), jarvisRunId: row.jarvis_run_id ? String(row.jarvis_run_id) : null, query: String(row.query), industry: String(row.industry), location: String(row.location), requestedLimit: Number(row.requested_limit), status: row.status as ResearchRun["status"], discoveredCount: Number(row.discovered_count ?? 0), verifiedCount: Number(row.verified_count ?? 0), analyzedCount: Number(row.analyzed_count ?? 0), qualifiedCount: Number(row.qualified_count ?? 0), failedCount: Number(row.failed_count ?? 0), processedCount: Number(row.processed_count ?? 0), config: row.config_json && typeof row.config_json === "object" ? row.config_json as Record<string, unknown> : {}, createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null }; }
export function mapResearchCandidate(row: Record<string, unknown>): ResearchCandidate { return { id: String(row.id), researchRunId: String(row.research_run_id), businessName: String(row.business_name), normalizedKey: String(row.normalized_key), industry: String(row.industry), location: String(row.location), officialWebsite: row.official_website ? String(row.official_website) : null, phone: row.phone ? String(row.phone) : null, email: row.email ? String(row.email) : null, status: row.status as ResearchCandidate["status"], sourceResults: Array.isArray(row.source_results) ? row.source_results as ResearchCandidate["sourceResults"] : [], leadId: row.lead_id ? String(row.lead_id) : null, error: row.error_message ? String(row.error_message) : null, createdAt: String(row.created_at) }; }
export function mapResearchSource(row: Record<string, unknown>): ResearchSource { return { id: String(row.id), leadId: row.lead_id ? String(row.lead_id) : null, researchRunId: row.research_run_id ? String(row.research_run_id) : null, candidateId: row.candidate_id ? String(row.candidate_id) : null, sourceType: row.source_type as ResearchSource["sourceType"], sourceUrl: String(row.source_url), title: String(row.title ?? ""), retrievedAt: String(row.retrieved_at), provider: String(row.provider), metadata: row.metadata_json && typeof row.metadata_json === "object" ? row.metadata_json as Record<string, unknown> : {}, createdAt: String(row.created_at) }; }
export function mapLeadEvidence(row: Record<string, unknown>): LeadEvidence { return { id: String(row.id), leadId: String(row.lead_id), fieldName: String(row.field_name), valueText: String(row.value_text), confidence: row.confidence as LeadEvidence["confidence"], sourceId: String(row.source_id), evidenceSummary: String(row.evidence_summary), verifiedAt: row.verified_at ? String(row.verified_at) : null, createdAt: String(row.created_at) }; }
export function mapWebsiteAnalysis(row: Record<string, unknown>): WebsiteAnalysis { const analysis = row.analysis_json && typeof row.analysis_json === "object" ? row.analysis_json as Record<string, unknown> : {}; return { id: String(row.id), leadId: row.lead_id ? String(row.lead_id) : null, candidateId: row.candidate_id ? String(row.candidate_id) : null, websiteUrl: String(row.website_url), status: row.status as WebsiteAnalysis["status"], title: row.title ? String(row.title) : null, metaDescription: row.meta_description ? String(row.meta_description) : null, language: row.language ? String(row.language) : null, hasViewportMeta: row.has_viewport_meta === null ? null : Boolean(row.has_viewport_meta), hasContactForm: row.has_contact_form === null ? null : Boolean(row.has_contact_form), hasBooking: row.has_booking === null ? null : Boolean(row.has_booking), hasClearCta: row.has_clear_cta === null ? null : Boolean(row.has_clear_cta), hasPhone: row.has_phone === null ? null : Boolean(row.has_phone), hasEmail: row.has_email === null ? null : Boolean(row.has_email), hasHttps: Boolean(row.has_https), phone: row.phone ? String(row.phone) : null, email: row.email ? String(row.email) : null, pagesAnalyzed: Array.isArray(row.pages_analyzed) ? row.pages_analyzed.map(String) : [], visibleText: "", strengths: Array.isArray(analysis.strengths) ? analysis.strengths.map(String) : [], digitalGaps: Array.isArray(analysis.digitalGaps) ? analysis.digitalGaps.map(String) : [], opportunities: Array.isArray(analysis.opportunities) ? analysis.opportunities.map(String) : [], unknowns: Array.isArray(analysis.unknowns) ? analysis.unknowns.map(String) : [], confidence: row.confidence as WebsiteAnalysis["confidence"], retrievedAt: String(row.retrieved_at) }; }

export type DbClient = SupabaseClient;
