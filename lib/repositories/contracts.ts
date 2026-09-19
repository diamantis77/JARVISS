import type { Activity, Approval, BusinessSettings, Interaction, JarvisRun, JarvisRunStep, Lead, LeadStatus, RunStatus, Task } from "../../types";

export interface LeadRepository {
  list(): Promise<Lead[]>;
  getById(id: string): Promise<Lead | null>;
  create(input: Omit<Lead, "id" | "lastActivity">): Promise<Lead>;
  update(id: string, patch: Partial<Pick<Lead, "businessName" | "category" | "city" | "country" | "website" | "email" | "phone" | "status" | "score" | "scoreReason" | "opportunitySummary" | "reviewCount">>): Promise<Lead>;
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

export interface Repositories {
  leads: LeadRepository;
  interactions: InteractionRepository;
  tasks: TaskRepository;
  runs: JarvisRunRepository;
  approvals: ApprovalRepository;
  activity: ActivityRepository;
  settings: SettingsRepository;
}

export type LeadUpdate = { status?: LeadStatus };
