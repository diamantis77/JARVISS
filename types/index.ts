export type LeadStatus = "new" | "analyzed" | "qualified" | "contacted" | "interested" | "meeting" | "won" | "lost";
export type RunStatus = "pending" | "running" | "completed" | "failed" | "waiting_for_approval" | "cancelled";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ProviderCapability = "gmail" | "calendar";
export type NotificationPriority = "info" | "important" | "urgent";
export type ToolPermission = "SAFE_AUTOMATIC" | "REQUIRES_USER_APPROVAL";
export type JarvisState = "idle" | "listening" | "thinking" | "executing" | "success" | "error";
export type VoiceState = "idle" | "requesting_microphone" | "connecting" | "listening" | "user_speaking" | "processing" | "jarvis_speaking" | "interrupted" | "reconnecting" | "error" | "disconnected";
export type EvidenceConfidence = "verified" | "high" | "medium" | "low" | "unknown";
export type ResearchStatus = "pending" | "running" | "partial" | "completed" | "cancelled" | "failed";
export type ResearchCandidateStatus = "discovered" | "verified" | "analyzed" | "qualified" | "failed" | "skipped";
export type BackgroundJobType = "gmail_sync" | "gmail_watch_renewal" | "calendar_sync" | "calendar_watch_renewal" | "provider_health_check" | "research_continue" | "notification_process" | "notification_cleanup" | "provider_reconciliation" | "daily_brief";
export type BackgroundJobStatus = "pending" | "scheduled" | "running" | "retrying" | "completed" | "failed" | "cancelled" | "dead_letter";
export type ProviderHealthStatus = "healthy" | "degraded" | "needs_reconnect" | "watch_expiring" | "disconnected" | "error";
export type InternalEventType = "EMAIL_RECEIVED" | "LEAD_REPLIED" | "HOT_LEAD_DETECTED" | "MEETING_REQUEST_DETECTED" | "MEETING_STARTING_SOON" | "RESEARCH_COMPLETED" | "APPROVAL_PENDING" | "PROVIDER_DISCONNECTED" | "DAILY_BRIEF_READY";

export interface Lead {
  id: string;
  businessName: string;
  category: string;
  city: string;
  country: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  source: "demo" | "provider";
  status: LeadStatus;
  score: number;
  scoreReason: string;
  opportunitySummary: string;
  reviewCount: number | null;
  lastActivity: string;
  scoreComponents?: ScoreComponent[];
  evidenceIds?: string[];
  researchConfidence?: EvidenceConfidence;
  lastResearchedAt?: string | null;
}

export interface LeadAnalysis {
  leadId: string;
  websiteQuality: "strong" | "needs_work" | "unknown";
  mobileQuality: "strong" | "poor" | "unknown";
  onlineBooking: "available" | "missing" | "unknown";
  ctaQuality: "strong" | "weak" | "unknown";
  onlinePresence: "strong" | "limited" | "unknown";
  problems: string[];
  opportunities: string[];
  evidence: string[];
}

export interface JarvisRunStep {
  id: string;
  order: number;
  title: string;
  description: string;
  status: RunStatus;
  toolName?: string;
  target?: string;
  result?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface JarvisRun {
  id: string;
  request: string;
  status: RunStatus;
  summary: string;
  currentStep: number;
  createdAt: string;
  steps: JarvisRunStep[];
  context?: Record<string, unknown>;
}

export interface Approval {
  id: string;
  runId: string;
  actionType: "send_email" | "update_crm" | "book_meeting" | "create_calendar_event" | "update_calendar_event" | "delete_calendar_event";
  status: ApprovalStatus;
  recipient: string;
  subject: string;
  preview: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
  resolvedAt?: string | null;
}

export interface Activity {
  id: string;
  time: string;
  eventType: "analysis" | "score" | "outreach" | "task" | "system";
  title: string;
  description: string;
}

export interface Task {
  id: string;
  title: string;
  leadId?: string;
  status: "open" | "completed";
  priority: "high" | "medium" | "low";
  due: string;
}

export interface Interaction {
  id: string;
  leadId: string;
  direction: "inbound" | "outbound";
  channel: "email" | "phone" | "sms" | "note";
  subject: string | null;
  content: string;
  status: string;
  createdAt: string;
  provider?: string | null;
  providerThreadId?: string | null;
  providerMessageId?: string | null;
  recipientEmail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface BusinessSettings {
  userId: string;
  fullName: string;
  businessName: string;
  defaultLanguage: string;
  targetIndustries: string[];
  targetLocations: string[];
  minimumLeadScore: number;
  companyServices: string[];
  companyDescription: string;
  researchMaxLeads: number;
  researchMaxPagesPerSite: number;
  researchFetchTimeoutMs: number;
  researchMaxConcurrency: number;
  researchAiAnalysisEnabled: boolean;
  jarvisVoice: "marin" | "cedar" | "coral" | "alloy";
  voiceMode: "conversation" | "push_to_talk";
  timezone: string;
  dailyBriefEnabled: boolean;
  dailyBriefTime: string;
}

export interface VoiceSession {
  id: string;
  providerSessionId: string | null;
  status: "connecting" | "active" | "ended" | "failed";
  model: string;
  voice: string;
  startedAt: string;
  endedAt: string | null;
}

export interface VoiceTranscript {
  id: string;
  voiceSessionId: string;
  jarvisRunId: string | null;
  commandId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface ProviderConnection {
  id: string;
  provider: "google";
  providerAccountId: string;
  providerEmail: string;
  status: "connected" | "needs_reconnect" | "disconnected" | "error";
  scopes: string[];
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: string | null;
  connectedAt: string;
  lastSyncAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface EmailThreadSummary {
  id: string;
  latestMessageId: string;
  from: string;
  to: string[];
  subject: string;
  snippet: string;
  receivedAt: string;
  labels: string[];
  leadId?: string | null;
}

export interface EmailThreadDetail extends EmailThreadSummary {
  messages: Array<{ id: string; from: string; to: string[]; subject: string; body: string; receivedAt: string; messageIdHeader: string | null }>;
}

export interface CalendarEventRecord {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  attendees: string[];
  location: string | null;
  description: string | null;
  status: string;
}

export interface JarvisNotification {
  id: string;
  type: "EMAIL_REPLY" | "HOT_LEAD_REPLY" | "APPROVAL_REQUIRED" | "MEETING_REQUEST" | "UPCOMING_MEETING" | "RESEARCH_COMPLETED" | "PROVIDER_ERROR" | "VOICE_ERROR" | "DAILY_BRIEF";
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProviderSyncState {
  connectionId: string;
  capability: ProviderCapability;
  checkpoint: string | null;
  watchExpiration: string | null;
  lastSuccessfulSyncAt: string | null;
  lastNotificationId: string | null;
}

export interface BackgroundJob {
  id: string;
  userId: string | null;
  jobType: BackgroundJobType;
  status: BackgroundJobStatus;
  payload: Record<string, unknown>;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  scheduledFor: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  deduplicationKey: string | null;
  correlationId: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProviderWatchChannel {
  id: string;
  connectionId: string;
  capability: ProviderCapability;
  channelId: string | null;
  resourceId: string | null;
  calendarId: string | null;
  verificationTokenHash: string | null;
  expiration: string | null;
  status: "active" | "expired" | "stopped" | "error";
  lastRenewalAttemptAt: string | null;
  lastRenewalSuccessAt: string | null;
  renewalError: string | null;
}

export interface ProviderHealth {
  connectionId: string;
  capability: ProviderCapability;
  status: ProviderHealthStatus;
  lastSuccessfulApiCallAt: string | null;
  lastSyncAt: string | null;
  lastWebhookAt: string | null;
  watchExpiration: string | null;
  consecutiveFailures: number;
  lastErrorCategory: string | null;
  lastErrorSummary: string | null;
}

export interface InternalEvent {
  id: string;
  userId: string;
  eventType: InternalEventType;
  payload: Record<string, unknown>;
  correlationId: string;
  deduplicationKey: string | null;
  occurredAt: string;
  processedAt: string | null;
}

export interface OperationsSnapshot {
  jobs: BackgroundJob[];
  health: ProviderHealth[];
  schedulerLastSeenAt: string | null;
  workerLastSeenAt: string | null;
  metrics: Record<string, number>;
}

export interface ResearchSource {
  id: string;
  leadId: string | null;
  researchRunId: string | null;
  candidateId: string | null;
  sourceType: "official_website" | "official_profile" | "directory" | "search_result" | "website_page";
  sourceUrl: string;
  title: string;
  retrievedAt: string;
  provider: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface LeadEvidence {
  id: string;
  leadId: string;
  fieldName: string;
  valueText: string;
  confidence: EvidenceConfidence;
  sourceId: string;
  evidenceSummary: string;
  verifiedAt: string | null;
  createdAt: string;
}

export interface WebsiteSignals {
  title: string | null;
  metaDescription: string | null;
  language: string | null;
  hasViewportMeta: boolean | null;
  hasContactForm: boolean | null;
  hasBooking: boolean | null;
  hasClearCta: boolean | null;
  hasPhone: boolean | null;
  hasEmail: boolean | null;
  hasHttps: boolean;
  phone: string | null;
  email: string | null;
  pagesAnalyzed: string[];
  visibleText: string;
}

export interface WebsiteAnalysis extends WebsiteSignals {
  id: string;
  leadId: string | null;
  candidateId: string | null;
  websiteUrl: string;
  status: "completed" | "partial" | "failed";
  strengths: string[];
  digitalGaps: string[];
  opportunities: string[];
  unknowns: string[];
  confidence: EvidenceConfidence;
  retrievedAt: string;
}

export interface ResearchCandidate {
  id: string;
  researchRunId: string;
  businessName: string;
  normalizedKey: string;
  industry: string;
  location: string;
  officialWebsite: string | null;
  phone: string | null;
  email: string | null;
  status: ResearchCandidateStatus;
  sourceResults: Array<{ title: string; url: string; snippet: string; sourceType: string }>;
  leadId: string | null;
  error: string | null;
  createdAt: string;
}

export interface ResearchRun {
  id: string;
  jarvisRunId: string | null;
  query: string;
  industry: string;
  location: string;
  requestedLimit: number;
  status: ResearchStatus;
  discoveredCount: number;
  verifiedCount: number;
  analyzedCount: number;
  qualifiedCount: number;
  failedCount: number;
  processedCount: number;
  config: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

export interface ScoreComponent {
  key: string;
  points: number;
  reason: string;
  evidenceIds: string[];
}
