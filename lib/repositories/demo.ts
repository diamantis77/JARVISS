import type { Repositories } from "./contracts";
import type { Activity, Approval, BusinessSettings, Interaction, JarvisRun, JarvisRunStep, Lead, Task } from "../../types";
import { demoActivities, demoApproval, demoLeads, demoRun, demoTasks } from "../demo-data";

export function createDemoRepositories(): Repositories {
  const leads: Lead[] = structuredClone(demoLeads);
  const tasks: Task[] = structuredClone(demoTasks);
  const activities: Activity[] = structuredClone(demoActivities);
  const runs: JarvisRun[] = [structuredClone(demoRun)];
  const approvals: Approval[] = [structuredClone(demoApproval)];
  const interactions: Interaction[] = [];
  let settings: BusinessSettings = { userId: "demo-user", fullName: "Demo Operator", businessName: "Northstar Studio", defaultLanguage: "en", targetIndustries: ["Healthcare"], targetLocations: ["Larissa", "Kos"], minimumLeadScore: 70, companyServices: ["Web design", "Growth strategy"], companyDescription: "Digital growth services for local professional businesses." };
  return {
    leads: {
      async list() { return [...leads].sort((a, b) => b.score - a.score); },
      async getById(id) { return leads.find((lead) => lead.id === id) ?? null; },
      async create(input) { const lead = { ...input, id: `demo_${crypto.randomUUID()}`, lastActivity: "Just now", source: "demo" as const }; leads.push(lead); return lead; },
      async update(id, patch) { const index = leads.findIndex((lead) => lead.id === id); if (index < 0) throw new Error("Lead not found"); leads[index] = { ...leads[index], ...patch, lastActivity: "Just now" }; return leads[index]; },
      async delete(id) { const index = leads.findIndex((lead) => lead.id === id); if (index >= 0) leads.splice(index, 1); },
      async search(query, limit = 10) { const term = query.toLowerCase().trim(); return leads.filter((lead) => !term || [lead.businessName, lead.category, lead.city].some((value) => value.toLowerCase().includes(term))).sort((a, b) => b.score - a.score).slice(0, limit); },
    },
    interactions: {
      async listForLead(leadId) { return interactions.filter((item) => item.leadId === leadId); },
      async create(input) { const item = { ...input, id: `interaction_${crypto.randomUUID()}`, createdAt: new Date().toISOString() }; interactions.push(item); return item; },
    },
    tasks: {
      async list(status) { return status ? tasks.filter((task) => task.status === status) : [...tasks]; },
      async create(input) { const task: Task = { id: `task_${crypto.randomUUID()}`, title: input.title, leadId: input.leadId, status: "open", priority: input.priority ?? "medium", due: input.dueAt ?? "No due date" }; tasks.push(task); return task; },
      async complete(id) { const task = tasks.find((item) => item.id === id); if (!task) throw new Error("Task not found"); task.status = "completed"; return task; },
    },
    runs: {
      async createRun(request) { const run: JarvisRun = { id: `run_${crypto.randomUUID()}`, request, status: "running", summary: "", currentStep: 0, createdAt: new Date().toISOString(), steps: [] }; runs.unshift(run); return run; },
      async updateRun(id, patch) { const run = runs.find((item) => item.id === id); if (!run) throw new Error("Run not found"); Object.assign(run, { status: patch.status ?? run.status, summary: patch.summary ?? run.summary, currentStep: patch.currentStep ?? run.currentStep, context: patch.context ?? run.context }); return run; },
      async addStep(runId, input) { const run = runs.find((item) => item.id === runId); if (!run) throw new Error("Run not found"); const step: JarvisRunStep = { ...input, id: `step_${crypto.randomUUID()}` }; run.steps.push(step); return step; },
      async updateStep(id, patch) { const step = runs.flatMap((run) => run.steps).find((item) => item.id === id); if (!step) throw new Error("Step not found"); Object.assign(step, patch); return step; },
      async getRun(id) { return runs.find((item) => item.id === id) ?? null; },
      async listRecentRuns(limit = 10) { return runs.slice(0, limit); },
    },
    approvals: {
      async create(input) { const approval: Approval = { id: `approval_${crypto.randomUUID()}`, runId: input.runId, actionType: input.actionType, status: "pending", recipient: input.recipient ?? "Unknown", subject: input.subject ?? input.actionType, preview: input.preview ?? "Review demo action", payload: input.payload, createdAt: new Date().toISOString(), resolvedAt: null }; approvals.unshift(approval); return approval; },
      async getById(id) { return approvals.find((item) => item.id === id) ?? null; },
      async getPending() { return approvals.filter((item) => item.status === "pending"); },
      async edit(id, patch) { const approval = approvals.find((item) => item.id === id); if (!approval || approval.status !== "pending") throw new Error("Approval not pending"); approval.subject = patch.subject; approval.preview = patch.preview; approval.payload = { ...(approval.payload ?? {}), subject: patch.subject, preview: patch.preview, input: { ...((approval.payload?.input as Record<string, unknown> | undefined) ?? {}), subject: patch.subject, preview: patch.preview } }; return approval; },
      async claimForExecution(id) { const approval = approvals.find((item) => item.id === id); if (!approval || approval.status !== "pending") throw new Error("Approval not pending"); approval.status = "approved"; approval.resolvedAt = new Date().toISOString(); return approval; },
      async recordExecution(id) { const approval = approvals.find((item) => item.id === id); if (!approval || approval.status !== "approved") throw new Error("Approval not approved"); return approval; },
      async resolve(id, status) { const approval = approvals.find((item) => item.id === id); if (!approval || approval.status !== "pending") throw new Error("Approval not pending"); approval.status = status; approval.resolvedAt = new Date().toISOString(); return approval; },
    },
    activity: {
      async list(limit = 20) { return activities.slice(0, limit); },
      async create(input) { const item: Activity = { ...input, id: `activity_${crypto.randomUUID()}`, time: new Date().toISOString() }; activities.unshift(item); return item; },
    },
    settings: {
      async get() { return settings; },
      async upsert(input) { settings = { ...input, userId: settings.userId }; return settings; },
    },
  };
}

const demoRuntime = globalThis as typeof globalThis & { __jarvisDemoRepositories?: Repositories };

export function getDemoRepositories(): Repositories {
  demoRuntime.__jarvisDemoRepositories ??= createDemoRepositories();
  return demoRuntime.__jarvisDemoRepositories;
}
