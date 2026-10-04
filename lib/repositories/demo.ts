import type { Repositories } from "./contracts";
import type { Activity, Approval, BusinessSettings, Interaction, JarvisNotification, JarvisRun, JarvisRunStep, Lead, LeadEvidence, ProviderConnection, ProviderHealth, ProviderSyncState, ProviderWatchChannel, ResearchCandidate, ResearchRun, ResearchSource, Task, VoiceSession, VoiceTranscript, WebsiteAnalysis } from "../../types";
import { demoActivities, demoApproval, demoLeads, demoRun, demoTasks } from "../demo-data";
import { MemoryJobQueue } from "../jobs/memory-queue";

export function createDemoRepositories(): Repositories {
  const leads: Lead[] = structuredClone(demoLeads);
  const tasks: Task[] = structuredClone(demoTasks);
  const activities: Activity[] = structuredClone(demoActivities);
  const runs: JarvisRun[] = [structuredClone(demoRun)];
  const approvals: Approval[] = [structuredClone(demoApproval)];
  const interactions: Interaction[] = [];
  const researchRuns: ResearchRun[] = [];
  const researchCandidates: ResearchCandidate[] = [];
  const researchSources: ResearchSource[] = [];
  const leadEvidence: LeadEvidence[] = [];
  const websiteAnalyses: WebsiteAnalysis[] = [];
  const voiceSessions: VoiceSession[] = [];
  const voiceTranscripts: VoiceTranscript[] = [];
  let googleConnection: ProviderConnection | null = null;
  const syncStates: ProviderSyncState[] = [];
  const watchChannels: ProviderWatchChannel[] = [];
  const providerHealth: ProviderHealth[] = [];
  const jobQueue = new MemoryJobQueue();
  const notifications: JarvisNotification[] = [{ id: "notification-demo-reply", type: "EMAIL_REPLY", priority: "important", title: "Demo reply from Papadopoulos Dental", body: "Fictional customer asked about availability tomorrow.", entityType: "email_thread", entityId: "demo-thread-1", readAt: null, dismissedAt: null, metadata: { demo: true }, createdAt: new Date().toISOString() }];
  let settings: BusinessSettings = { userId: "demo-user", fullName: "Demo Χρήστης", businessName: "Northstar Studio", defaultLanguage: "el-GR", targetIndustries: ["Υγεία"], targetLocations: ["Λάρισα", "Κως"], minimumLeadScore: 70, companyServices: ["Σχεδιασμός ιστοτόπων", "Στρατηγική ανάπτυξης"], companyDescription: "Υπηρεσίες ψηφιακής ανάπτυξης για τοπικές επαγγελματικές επιχειρήσεις.", researchMaxLeads: 20, researchMaxPagesPerSite: 5, researchFetchTimeoutMs: 8000, researchMaxConcurrency: 2, researchAiAnalysisEnabled: false, jarvisVoice: "cedar", voiceMode: "conversation", wakeModeEnabled: true, wakePhrase: "Hey Jarvis", preferredFormOfAddress: "κύριε", wakeSoundEnabled: true, voiceConversationIdleTimeoutMs: 120000, voiceMicrophoneDeviceId: "", timezone: "Europe/Athens", dailyBriefEnabled: false, dailyBriefTime: "08:30" };
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
      async getById(id) { return interactions.find((item) => item.id === id) ?? null; },
      async getByProviderMessageId(provider, messageId) { return interactions.find((item) => item.provider === provider && item.providerMessageId === messageId) ?? null; },
      async create(input) { const item = { ...input, id: `interaction_${crypto.randomUUID()}`, createdAt: new Date().toISOString() }; interactions.push(item); return item; },
      async updateStatus(id, status) { const item = interactions.find((entry) => entry.id === id); if (!item) throw new Error("Interaction not found"); item.status = status; return item; },
      async claimDraftForSend(id) { const item = interactions.find((entry) => entry.id === id); if (!item || item.status !== "draft") return false; item.status = "sending"; return true; },
      async recordSent(id, messageId, threadId) { const item = interactions.find((entry) => entry.id === id); if (!item || item.status !== "sending") throw new Error("Email draft is not in sending state"); item.status = "sent"; item.providerMessageId = messageId; item.providerThreadId = threadId; return item; },
      async isMissionContactSuppressed() { return false; },
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
      async edit(id, patch) { const approval = approvals.find((item) => item.id === id); if (!approval || approval.status !== "pending") throw new Error("Approval not pending"); approval.subject = patch.subject; approval.preview = patch.preview; const original = (approval.payload?.input as Record<string, unknown> | undefined) ?? {}; const input = { ...original, subject: patch.subject, ...(approval.payload?.toolName === "send_email" ? { body: patch.preview } : { preview: patch.preview }) }; approval.payload = { ...(approval.payload ?? {}), subject: patch.subject, preview: patch.preview, input, approvalRevision: Number(approval.payload?.approvalRevision ?? 1) + 1 }; return approval; },
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
    research: {
      async createRun(input) { const run: ResearchRun = { id: `research_${crypto.randomUUID()}`, jarvisRunId: input.jarvisRunId, query: input.query, industry: input.industry, location: input.location, requestedLimit: input.requestedLimit, status: "running", discoveredCount: 0, verifiedCount: 0, analyzedCount: 0, qualifiedCount: 0, failedCount: 0, processedCount: 0, config: input.config, createdAt: new Date().toISOString(), completedAt: null }; researchRuns.unshift(run); return run; },
      async getRun(id) { return researchRuns.find((run) => run.id === id) ?? null; },
      async listRecent(limit) { return researchRuns.slice(0, limit); },
      async updateRun(id, patch) { const run = researchRuns.find((item) => item.id === id); if (!run) throw new Error("Research run not found"); Object.assign(run, patch); return run; },
      async addCandidates(runId, candidates) { const added: ResearchCandidate[] = []; for (const input of candidates) { if (researchCandidates.some((item) => item.researchRunId === runId && item.normalizedKey === input.normalizedKey)) continue; const candidate: ResearchCandidate = { ...input, id: `candidate_${crypto.randomUUID()}`, researchRunId: runId, leadId: null, error: null, createdAt: new Date().toISOString() }; researchCandidates.push(candidate); added.push(candidate); } return added; },
      async listCandidates(runId) { return researchCandidates.filter((item) => item.researchRunId === runId); },
      async listPendingCandidates(runId, limit) { return researchCandidates.filter((item) => item.researchRunId === runId && item.status === "discovered").slice(0, limit); },
      async updateCandidate(id, patch) { const candidate = researchCandidates.find((item) => item.id === id); if (!candidate) throw new Error("Research candidate not found"); Object.assign(candidate, patch); return candidate; },
      async claimContinuation(id) { const run = researchRuns.find((item) => item.id === id); if (!run || run.status !== "partial") throw new Error("Research batch is already active or resolved"); run.status = "running"; return run; },
      async cancel(id) { const run = researchRuns.find((item) => item.id === id); if (!run) throw new Error("Research run not found"); run.status = "cancelled"; run.completedAt = new Date().toISOString(); return run; },
    },
    evidence: {
      async addSource(input) { const item: ResearchSource = { ...input, id: `source_${crypto.randomUUID()}`, retrievedAt: input.retrievedAt ?? new Date().toISOString(), createdAt: new Date().toISOString() }; researchSources.push(item); return item; },
      async addEvidence(input) { const item: LeadEvidence = { ...input, id: `evidence_${crypto.randomUUID()}`, createdAt: new Date().toISOString() }; leadEvidence.push(item); return item; },
      async addWebsiteAnalysis(input) { const item: WebsiteAnalysis = { ...input, visibleText: "", id: `website_${crypto.randomUUID()}`, retrievedAt: input.retrievedAt ?? new Date().toISOString() }; websiteAnalyses.push(item); return item; },
      async listSourcesForLead(leadId) { return researchSources.filter((item) => item.leadId === leadId); },
      async listEvidenceForLead(leadId) { return leadEvidence.filter((item) => item.leadId === leadId); },
      async listWebsiteAnalysesForLead(leadId) { return websiteAnalyses.filter((item) => item.leadId === leadId); },
    },
    voice: {
      async createSession(input) { const item: VoiceSession = { id: `voice_${crypto.randomUUID()}`, providerSessionId: input.providerSessionId, status: "connecting", model: input.model, voice: input.voice, startedAt: new Date().toISOString(), endedAt: null }; voiceSessions.push(item); return item; },
      async updateSession(id, patch) { const item = voiceSessions.find((session) => session.id === id); if (!item) throw new Error("Voice session not found"); Object.assign(item, patch); return item; },
      async getSession(id) { return voiceSessions.find((session) => session.id === id) ?? null; },
      async addTranscript(input) { const duplicate = voiceTranscripts.find((item) => item.voiceSessionId === input.voiceSessionId && item.commandId === input.commandId && item.role === input.role); if (duplicate) return duplicate; const item: VoiceTranscript = { ...input, id: `voice_transcript_${crypto.randomUUID()}`, createdAt: new Date().toISOString() }; voiceTranscripts.push(item); return item; },
      async listTranscripts(sessionId) { return voiceTranscripts.filter((item) => item.voiceSessionId === sessionId); },
    },
    connections: {
      async getGoogle() { return googleConnection; },
      async upsertGoogle(input) { googleConnection = { ...input, id: googleConnection?.id ?? `connection_${crypto.randomUUID()}`, connectedAt: googleConnection?.connectedAt ?? new Date().toISOString() }; return googleConnection; },
      async update(id, patch) { if (!googleConnection || googleConnection.id !== id) throw new Error("Connection not found"); googleConnection = { ...googleConnection, ...patch }; return googleConnection; },
      async disconnect(id) { if (!googleConnection || googleConnection.id !== id) throw new Error("Connection not found"); googleConnection = { ...googleConnection, status: "disconnected", accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null }; return googleConnection; },
      async getSyncState(connectionId, capability) { return syncStates.find((state) => state.connectionId === connectionId && state.capability === capability) ?? null; },
      async upsertSyncState(state) { const index = syncStates.findIndex((item) => item.connectionId === state.connectionId && item.capability === state.capability); if (index >= 0) syncStates[index] = state; else syncStates.push(state); return state; },
      async listWatchChannels(capability) { return watchChannels.filter((item) => !capability || item.capability === capability); },
      async getWatchChannel(channelId) { return watchChannels.find((item) => item.channelId === channelId) ?? null; },
      async upsertWatchChannel(input) { const index = watchChannels.findIndex((item) => item.connectionId === input.connectionId && item.capability === input.capability && item.channelId === input.channelId); const item = { ...input, id: index >= 0 ? watchChannels[index].id : `watch_${crypto.randomUUID()}` }; if (index >= 0) watchChannels[index] = item; else watchChannels.push(item); return item; },
      async updateWatchChannel(id, patch) { const item = watchChannels.find((entry) => entry.id === id); if (!item) throw new Error("Watch not found"); Object.assign(item, patch); return item; },
      async listHealth() { return [...providerHealth]; },
      async upsertHealth(health) { const index = providerHealth.findIndex((item) => item.connectionId === health.connectionId && item.capability === health.capability); if (index >= 0) providerHealth[index] = health; else providerHealth.push(health); return health; },
    },
    notifications: {
      async list(limit = 20, unreadOnly = false) { return notifications.filter((item) => !item.dismissedAt && (!unreadOnly || !item.readAt)).slice(0, limit); },
      async create(input) { const dedupe = input.metadata.dedupeKey; const existing = typeof dedupe === "string" ? notifications.find((item) => item.metadata.dedupeKey === dedupe) : null; if (existing) return existing; const item: JarvisNotification = { ...input, id: `notification_${crypto.randomUUID()}`, readAt: null, dismissedAt: null, createdAt: new Date().toISOString() }; notifications.unshift(item); return item; },
      async markRead(id) { const item = notifications.find((entry) => entry.id === id); if (!item) throw new Error("Notification not found"); item.readAt = new Date().toISOString(); return item; },
      async dismiss(id) { const item = notifications.find((entry) => entry.id === id); if (!item) throw new Error("Notification not found"); item.dismissedAt = new Date().toISOString(); return item; },
    },
    operations: {
      async listJobs(limit = 100) { return jobQueue.listJobs("demo-user", limit); },
      async snapshot() { const jobs = await jobQueue.listJobs("demo-user", 100); return { jobs, health: [...providerHealth], schedulerLastSeenAt: null, workerLastSeenAt: null, metrics: { jobs_pending: jobs.filter((job) => ["pending", "scheduled", "retrying"].includes(job.status)).length, jobs_failed: jobs.filter((job) => ["failed", "dead_letter"].includes(job.status)).length, jobs_completed: jobs.filter((job) => job.status === "completed").length } }; },
      async retryJob(id) { const job = await jobQueue.getJob(id, "demo-user"); if (!job) throw new Error("Job not found"); return jobQueue.enqueue({ userId: "demo-user", jobType: job.jobType, payload: job.payload, deduplicationKey: `${job.deduplicationKey ?? job.id}:retry:${Date.now()}` }); },
      async cancelJob(id) { return jobQueue.cancel(id, "demo-user"); },
    },
    missions: { async today() { return { available: false, missions: [] }; } },
  };
}

const demoRuntime = globalThis as typeof globalThis & { __jarvisDemoRepositories?: Repositories };

export function getDemoRepositories(): Repositories {
  demoRuntime.__jarvisDemoRepositories ??= createDemoRepositories();
  return demoRuntime.__jarvisDemoRepositories;
}
