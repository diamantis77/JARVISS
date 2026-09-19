import type { Repositories } from "../repositories/contracts";
import type { RuntimeMode } from "../config/runtime";
import type { ToolPermission } from "../../types";
import type { ResearchService } from "../research/contracts";
import { z } from "zod";

export interface ToolRuntimeContext { repositories: Repositories; mode: RuntimeMode; jarvisRunId?: string; researchService?: ResearchService; emitProgress?: (description: string, metadata?: Record<string, unknown>) => Promise<void> | void }
export interface JarvisTool<TInput extends z.ZodType, TOutput extends z.ZodType> {
  name: string; description: string; permission: ToolPermission; input: TInput; output: TOutput; parameters: Record<string, unknown>;
  execute: (context: ToolRuntimeContext, input: z.infer<TInput>) => Promise<z.infer<TOutput>>;
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const stringProp = (description: string) => ({ type: "string", description });
const leadOutput = z.object({ id: z.string(), businessName: z.string(), category: z.string(), city: z.string(), score: z.number(), status: z.string(), opportunitySummary: z.string(), source: z.string() });
const compactLead = (lead: Awaited<ReturnType<Repositories["leads"]["getById"]>>) => lead ? ({ id: lead.id, businessName: lead.businessName, category: lead.category, city: lead.city, score: lead.score, status: lead.status, opportunitySummary: lead.opportunitySummary, source: lead.source }) : null;

const registry = {
  get_lead: {
    name: "get_lead", description: "Retrieve one CRM lead by its exact ID.", permission: "SAFE_AUTOMATIC", input: z.object({ leadId: z.string().min(1) }), output: z.object({ lead: leadOutput.nullable() }), parameters: objectSchema({ leadId: stringProp("Exact CRM lead ID") }),
    execute: async ({ repositories }, { leadId }) => ({ lead: compactLead(await repositories.leads.getById(leadId)) }),
  },
  search_crm: {
    name: "search_crm", description: "Search the authenticated user's CRM by business, category, or city. Empty query returns strongest leads.", permission: "SAFE_AUTOMATIC", input: z.object({ query: z.string().max(200).default(""), limit: z.number().int().min(1).max(25).default(10) }), output: z.object({ leads: z.array(leadOutput), count: z.number() }), parameters: objectSchema({ query: stringProp("Search text; use an empty string for strongest leads"), limit: { type: "integer", minimum: 1, maximum: 25 } }),
    execute: async ({ repositories }, { query, limit }) => { const leads = await repositories.leads.search(query, limit); return { leads: leads.map((lead) => compactLead(lead)!), count: leads.length }; },
  },
  save_lead: {
    name: "save_lead", description: "Save a lead to the authenticated user's CRM. Use only provided, verified or explicitly demo data.", permission: "SAFE_AUTOMATIC",
    input: z.object({ businessName: z.string().min(1), category: z.string().default("Unknown"), city: z.string().default("Unknown"), country: z.string().default("Unknown"), website: z.string().url().nullable().default(null), email: z.string().email().nullable().default(null), phone: z.string().nullable().default(null), score: z.number().int().min(0).max(100).default(0), scoreReason: z.string().default("Unknown"), opportunitySummary: z.string().default("Unknown"), reviewCount: z.number().int().min(0).nullable().default(null) }), output: z.object({ lead: leadOutput }),
    parameters: objectSchema({ businessName: stringProp("Business name"), category: stringProp("Business category or Unknown"), city: stringProp("City or Unknown"), country: stringProp("Country or Unknown"), website: { type: ["string", "null"] }, email: { type: ["string", "null"] }, phone: { type: ["string", "null"] }, score: { type: "integer", minimum: 0, maximum: 100 }, scoreReason: stringProp("Evidence-based reason"), opportunitySummary: stringProp("Concise opportunity or Unknown"), reviewCount: { type: ["integer", "null"], minimum: 0 } }),
    execute: async ({ repositories, mode }, input) => { const lead = await repositories.leads.create({ ...input, source: mode === "demo" ? "demo" : "provider", status: "new" }); await repositories.activity.create({ eventType: "system", title: "Lead saved", description: lead.businessName, metadata: { leadId: lead.id } }); return { lead: compactLead(lead)! }; },
  },
  update_lead: {
    name: "update_lead", description: "Change important CRM status or opportunity information. This always requires explicit user approval.", permission: "REQUIRES_USER_APPROVAL", input: z.object({ leadId: z.string().min(1), status: z.enum(["new", "analyzed", "qualified", "contacted", "interested", "meeting", "won", "lost"]).optional(), opportunitySummary: z.string().max(1000).optional() }), output: z.object({ lead: leadOutput }), parameters: objectSchema({ leadId: stringProp("Exact lead ID"), status: { type: "string", enum: ["new", "analyzed", "qualified", "contacted", "interested", "meeting", "won", "lost"] }, opportunitySummary: stringProp("Updated summary") }, ["leadId"]),
    execute: async ({ repositories }, input) => { const lead = await repositories.leads.update(input.leadId, { status: input.status, opportunitySummary: input.opportunitySummary }); await repositories.activity.create({ eventType: "system", title: "Lead updated", description: lead.businessName, metadata: { leadId: lead.id } }); return { lead: compactLead(lead)! }; },
  },
  create_task: {
    name: "create_task", description: "Create a persistent internal task for the authenticated user.", permission: "SAFE_AUTOMATIC", input: z.object({ title: z.string().min(1).max(300), description: z.string().max(2000).optional(), leadId: z.string().optional(), priority: z.enum(["high", "medium", "low"]).default("medium"), dueAt: z.string().datetime().optional() }), output: z.object({ id: z.string(), title: z.string(), status: z.string(), due: z.string() }), parameters: objectSchema({ title: stringProp("Task title"), description: stringProp("Optional task detail"), leadId: stringProp("Optional CRM lead ID"), priority: { type: "string", enum: ["high", "medium", "low"] }, dueAt: stringProp("ISO 8601 due time when known") }, ["title"]),
    execute: async ({ repositories }, input) => { const task = await repositories.tasks.create(input); await repositories.activity.create({ eventType: "task", title: "Task created", description: task.title, metadata: { taskId: task.id } }); return { id: task.id, title: task.title, status: task.status, due: task.due }; },
  },
  complete_task: {
    name: "complete_task", description: "Mark one authenticated user's internal task complete.", permission: "SAFE_AUTOMATIC", input: z.object({ taskId: z.string().min(1) }), output: z.object({ id: z.string(), status: z.literal("completed") }), parameters: objectSchema({ taskId: stringProp("Exact task ID") }),
    execute: async ({ repositories }, { taskId }) => { const task = await repositories.tasks.complete(taskId); await repositories.activity.create({ eventType: "task", title: "Task completed", description: task.title, metadata: { taskId } }); return { id: task.id, status: "completed" as const }; },
  },
  get_activity_log: {
    name: "get_activity_log", description: "Read recent auditable JARVIS activity for the authenticated user.", permission: "SAFE_AUTOMATIC", input: z.object({ limit: z.number().int().min(1).max(50).default(20) }), output: z.object({ activities: z.array(z.object({ id: z.string(), time: z.string(), title: z.string(), description: z.string() })) }), parameters: objectSchema({ limit: { type: "integer", minimum: 1, maximum: 50 } }),
    execute: async ({ repositories }, { limit }) => ({ activities: (await repositories.activity.list(limit)).map(({ id, time, title, description }) => ({ id, time, title, description })) }),
  },
  analyze_business: {
    name: "analyze_business", description: "Summarize accumulated, stored evidence for one CRM lead without inventing missing facts.", permission: "SAFE_AUTOMATIC", input: z.object({ leadId: z.string().min(1) }), output: z.object({ summary: z.string(), strengths: z.array(z.string()), digitalGaps: z.array(z.string()), unknowns: z.array(z.string()), evidenceReferences: z.array(z.string()), confidence: z.string() }), parameters: objectSchema({ leadId: stringProp("Exact CRM lead ID") }),
    execute: async ({ repositories }, { leadId }) => { const lead = await repositories.leads.getById(leadId); if (!lead) throw new Error("Lead not found"); const [evidence, analyses] = await Promise.all([repositories.evidence.listEvidenceForLead(leadId), repositories.evidence.listWebsiteAnalysesForLead(leadId)]); const latest = analyses[0]; return { summary: `${lead.businessName}: ${lead.opportunitySummary}`, strengths: latest?.strengths ?? [], digitalGaps: latest?.digitalGaps ?? [], unknowns: latest?.unknowns ?? (evidence.length ? [] : ["No verified research evidence is stored."]), evidenceReferences: evidence.map((item) => item.id), confidence: lead.researchConfidence ?? "unknown" }; },
  },
  score_lead: {
    name: "score_lead", description: "Return the lead's stored deterministic score, components and evidence references.", permission: "SAFE_AUTOMATIC", input: z.object({ leadId: z.string().min(1) }), output: z.object({ score: z.number(), reason: z.string(), components: z.array(z.object({ key: z.string(), points: z.number(), reason: z.string(), evidenceIds: z.array(z.string()) })), evidenceIds: z.array(z.string()) }), parameters: objectSchema({ leadId: stringProp("Exact CRM lead ID") }),
    execute: async ({ repositories }, { leadId }) => { const lead = await repositories.leads.getById(leadId); if (!lead) throw new Error("Lead not found"); return { score: lead.score, reason: lead.scoreReason, components: lead.scoreComponents ?? [], evidenceIds: lead.evidenceIds ?? [] }; },
  },
  draft_outreach: {
    name: "draft_outreach", description: "Create and persist a personalized email draft from stored CRM evidence. This does not send it.", permission: "SAFE_AUTOMATIC", input: z.object({ leadId: z.string().min(1), subject: z.string().min(1).max(200), body: z.string().min(1).max(5000) }), output: z.object({ id: z.string(), status: z.literal("draft"), recipient: z.string() }), parameters: objectSchema({ leadId: stringProp("Exact lead ID"), subject: stringProp("Specific concise subject"), body: stringProp("Personalized outreach using only verified CRM facts") }),
    execute: async ({ repositories }, { leadId, subject, body }) => { const lead = await repositories.leads.getById(leadId); if (!lead) throw new Error("Lead not found"); const draft = await repositories.interactions.create({ leadId, direction: "outbound", channel: "email", subject, content: body, status: "draft" }); await repositories.activity.create({ eventType: "outreach", title: "Outreach draft created", description: lead.businessName, metadata: { draftId: draft.id, leadId } }); return { id: draft.id, status: "draft" as const, recipient: lead.email ?? "Unknown" }; },
  },
  search_leads: {
    name: "search_leads", description: "Start evidence-first public business research. It discovers, deduplicates and processes a persisted batch without contacting anyone.", permission: "SAFE_AUTOMATIC",
    input: z.object({ industry: z.string().min(1).max(200), location: z.string().min(1).max(200), limit: z.number().int().min(1).max(50).default(10), criteria: z.record(z.unknown()).optional() }),
    output: z.object({ researchRunId: z.string(), status: z.enum(["partial", "completed", "cancelled", "failed"]), discoveredCount: z.number(), verifiedCount: z.number(), analyzedCount: z.number(), qualifiedCount: z.number(), failedCount: z.number(), processedCount: z.number(), message: z.string(), leads: z.array(leadOutput) }),
    parameters: objectSchema({ industry: stringProp("Target industry"), location: stringProp("Target city/area and country when known"), limit: { type: "integer", minimum: 1, maximum: 50 }, criteria: { type: "object", additionalProperties: true } }, ["industry", "location", "limit"]),
    execute: async ({ researchService, jarvisRunId, emitProgress }, input) => researchService ? researchService.start({ jarvisRunId: jarvisRunId ?? "", ...input, onProgress: (progress) => emitProgress?.(progress.description, { researchRunId: progress.researchRunId, researchStatus: progress.status, processed: progress.processed, total: progress.total }) }) : ({ researchRunId: "", status: "failed" as const, discoveredCount: 0, verifiedCount: 0, analyzedCount: 0, qualifiedCount: 0, failedCount: 0, processedCount: 0, message: "Live web research is not configured.", leads: [] }),
  },
  search_web: {
    name: "search_web", description: "Search the real public web and return structured, cited results when Live Research is enabled.", permission: "SAFE_AUTOMATIC",
    input: z.object({ query: z.string().min(2).max(500), location: z.string().max(200).optional(), maxResults: z.number().int().min(1).max(25).default(10) }),
    output: z.object({ results: z.array(z.object({ title: z.string(), url: z.string().url(), snippet: z.string(), sourceType: z.string() })), error: z.string().optional() }),
    parameters: objectSchema({ query: stringProp("Focused public web query"), location: stringProp("Optional geographic focus"), maxResults: { type: "integer", minimum: 1, maximum: 25 } }, ["query", "maxResults"]),
    execute: async ({ researchService }, input) => researchService ? researchService.searchWeb(input) : { results: [], error: "Live web research is not configured." },
  },
  continue_research: {
    name: "continue_research", description: "Resume the next persisted research batch without duplicating completed candidates.", permission: "SAFE_AUTOMATIC",
    input: z.object({ researchRunId: z.string().min(1) }),
    output: z.object({ researchRunId: z.string(), status: z.enum(["partial", "completed", "cancelled", "failed"]), discoveredCount: z.number(), verifiedCount: z.number(), analyzedCount: z.number(), qualifiedCount: z.number(), failedCount: z.number(), processedCount: z.number(), message: z.string(), leads: z.array(leadOutput) }),
    parameters: objectSchema({ researchRunId: stringProp("Persisted research run ID") }),
    execute: async ({ researchService, emitProgress }, { researchRunId }) => researchService ? researchService.continue({ researchRunId, onProgress: (progress) => emitProgress?.(progress.description, { researchRunId, researchStatus: progress.status, processed: progress.processed, total: progress.total }) }) : ({ researchRunId, status: "failed" as const, discoveredCount: 0, verifiedCount: 0, analyzedCount: 0, qualifiedCount: 0, failedCount: 0, processedCount: 0, message: "Live web research is not configured.", leads: [] }),
  },
  cancel_research: {
    name: "cancel_research", description: "Cancel an active research run while preserving completed evidence.", permission: "SAFE_AUTOMATIC", input: z.object({ researchRunId: z.string().min(1) }), output: z.object({ cancelled: z.literal(true), researchRunId: z.string() }), parameters: objectSchema({ researchRunId: stringProp("Persisted research run ID") }), execute: async ({ researchService }, { researchRunId }) => { if (!researchService) throw new Error("Research unavailable"); await researchService.cancel(researchRunId); return { cancelled: true as const, researchRunId }; },
  },
  get_business_details: {
    name: "get_business_details", description: "Retrieve stored business-provider details. Use search_web or search_leads for live public research; otherwise fields remain Unknown.", permission: "SAFE_AUTOMATIC",
    input: z.object({ businessName: z.string().min(1).max(300), location: z.string().max(200).optional() }),
    output: z.object({ businessName: z.string(), details: z.string(), connected: z.boolean() }),
    parameters: objectSchema({ businessName: stringProp("Business name to look up"), location: stringProp("Location when known") }, ["businessName"]),
    execute: async (_context, { businessName }) => ({ businessName, details: "Unknown — no external business-data provider is connected.", connected: false }),
  },
  analyze_website: {
    name: "analyze_website", description: "Safely fetch and re-analyze a lead's public website, storing new historical evidence.", permission: "SAFE_AUTOMATIC", input: z.object({ leadId: z.string().min(1), url: z.string().url() }), output: z.object({ message: z.string(), analysis: z.unknown().optional() }), parameters: objectSchema({ leadId: stringProp("Exact CRM lead ID"), url: stringProp("Public HTTP(S) website URL") }), execute: async ({ researchService, emitProgress }, input) => researchService ? researchService.analyzeWebsite({ ...input, onProgress: (progress) => emitProgress?.(progress.description) }) : ({ message: "Live web research is not configured." }),
  },
  send_email: {
    name: "send_email", description: "Send an external email draft. Requires explicit user approval and a connected provider.", permission: "REQUIRES_USER_APPROVAL", input: z.object({ draftId: z.string().min(1), recipient: z.string().email().optional(), subject: z.string().optional(), preview: z.string().optional() }), output: z.object({ sent: z.boolean(), reason: z.string() }), parameters: objectSchema({ draftId: stringProp("Stored draft ID"), recipient: stringProp("Recipient email when known"), subject: stringProp("Email subject when known"), preview: stringProp("Email preview for approval when known") }, ["draftId"]), execute: async () => ({ sent: false, reason: "Email provider not connected." }),
  },
} satisfies Record<string, JarvisTool<z.ZodType, z.ZodType>>;

export const toolRegistry = registry;
export type ToolName = keyof typeof toolRegistry;
export function isToolName(value: string): value is ToolName { return value in toolRegistry; }
export function mayExecute(permission: ToolPermission, isApproved: boolean): boolean { return permission === "SAFE_AUTOMATIC" || isApproved; }
export function openAiTools() { return Object.values(toolRegistry).map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })); }
