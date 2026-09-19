import type { Activity, Approval, BusinessSettings, Interaction, JarvisRun, JarvisRunStep, Lead, LeadEvidence, LeadStatus, ResearchCandidate, ResearchRun, ResearchSource, ResearchStatus, RunStatus, Task, WebsiteAnalysis } from "../../types";

export interface LeadRepository {
  list(): Promise<Lead[]>;
  getById(id: string): Promise<Lead | null>;
  create(input: Omit<Lead, "id" | "lastActivity">): Promise<Lead>;
  update(id: string, patch: Partial<Pick<Lead, "businessName" | "category" | "city" | "country" | "website" | "email" | "phone" | "status" | "score" | "scoreReason" | "opportunitySummary" | "reviewCount" | "scoreComponents" | "evidenceIds" | "researchConfidence" | "lastResearchedAt">>): Promise<Lead>;
  delete(id: string): Promise<void>;
  search(query: string, limit?: number): Promise<Lead[]>;
}

export interface InteractionRepository {
  listForLead(leadId: string): Promise<Interaction[]>;
  create(input: Omit<Interaction, "id" | "createdAt">): Promise<Interaction>;
}

export interface TaskRepository {
  list(status?: "open" | "completed"): Promise<Task[]>;
  create(input: { title: string; description?: string; leadId?: string; priority?: Task["priority"]; dueAt?: string }): Promise<Task>;
  complete(id: string): Promise<Task>;
}

export interface JarvisRunRepository {
  createRun(request: string): Promise<JarvisRun>;
  updateRun(id: string, patch: { status?: RunStatus; summary?: string; currentStep?: number; providerResponseId?: string; context?: Record<string, unknown> }): Promise<JarvisRun>;
  addStep(runId: string, input: Omit<JarvisRunStep, "id">): Promise<JarvisRunStep>;
  updateStep(id: string, patch: Partial<Pick<JarvisRunStep, "status" | "description" | "result" | "output" | "error">>): Promise<JarvisRunStep>;
  getRun(id: string): Promise<JarvisRun | null>;
  listRecentRuns(limit?: number): Promise<JarvisRun[]>;
}

export interface ApprovalRepository {
  create(input: { runId: string; actionType: Approval["actionType"]; payload: Record<string, unknown>; recipient?: string; subject?: string; preview?: string }): Promise<Approval>;
  getById(id: string): Promise<Approval | null>;
  getPending(): Promise<Approval[]>;
  edit(id: string, patch: { subject: string; preview: string }): Promise<Approval>;
  claimForExecution(id: string): Promise<Approval>;
  recordExecution(id: string, result?: unknown, executionError?: string): Promise<Approval>;
  resolve(id: string, status: "approved" | "rejected", result?: unknown, executionError?: string): Promise<Approval>;
}

export interface ActivityRepository {
  list(limit?: number): Promise<Activity[]>;
  create(input: Omit<Activity, "id" | "time"> & { metadata?: Record<string, unknown> }): Promise<Activity>;
}

export interface SettingsRepository {
  get(): Promise<BusinessSettings>;
  upsert(settings: Omit<BusinessSettings, "userId">): Promise<BusinessSettings>;
}

export interface ResearchRepository {
  createRun(input: { jarvisRunId: string | null; query: string; industry: string; location: string; requestedLimit: number; config: Record<string, unknown> }): Promise<ResearchRun>;
  getRun(id: string): Promise<ResearchRun | null>;
  updateRun(id: string, patch: Partial<Pick<ResearchRun, "status" | "discoveredCount" | "verifiedCount" | "analyzedCount" | "qualifiedCount" | "failedCount" | "processedCount" | "completedAt">>): Promise<ResearchRun>;
  addCandidates(runId: string, candidates: Array<Omit<ResearchCandidate, "id" | "researchRunId" | "leadId" | "error" | "createdAt">>): Promise<ResearchCandidate[]>;
  listCandidates(runId: string): Promise<ResearchCandidate[]>;
  listPendingCandidates(runId: string, limit: number): Promise<ResearchCandidate[]>;
  updateCandidate(id: string, patch: Partial<Pick<ResearchCandidate, "status" | "officialWebsite" | "phone" | "email" | "leadId" | "error">>): Promise<ResearchCandidate>;
  claimContinuation(id: string): Promise<ResearchRun>;
  cancel(id: string): Promise<ResearchRun>;
}

export interface EvidenceRepository {
  addSource(input: Omit<ResearchSource, "id" | "createdAt" | "retrievedAt"> & { retrievedAt?: string }): Promise<ResearchSource>;
  addEvidence(input: Omit<LeadEvidence, "id" | "createdAt">): Promise<LeadEvidence>;
  addWebsiteAnalysis(input: Omit<WebsiteAnalysis, "id" | "retrievedAt"> & { retrievedAt?: string }): Promise<WebsiteAnalysis>;
  listSourcesForLead(leadId: string): Promise<ResearchSource[]>;
  listEvidenceForLead(leadId: string): Promise<LeadEvidence[]>;
  listWebsiteAnalysesForLead(leadId: string): Promise<WebsiteAnalysis[]>;
}

export interface Repositories {
  leads: LeadRepository;
  interactions: InteractionRepository;
  tasks: TaskRepository;
  runs: JarvisRunRepository;
  approvals: ApprovalRepository;
  activity: ActivityRepository;
  settings: SettingsRepository;
  research: ResearchRepository;
  evidence: EvidenceRepository;
}

export type LeadUpdate = { status?: LeadStatus };
