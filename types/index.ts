export type LeadStatus = "new" | "analyzed" | "qualified" | "contacted" | "interested" | "meeting" | "won" | "lost";
export type RunStatus = "pending" | "running" | "completed" | "failed" | "waiting_for_approval";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ToolPermission = "SAFE_AUTOMATIC" | "REQUIRES_USER_APPROVAL";
export type JarvisState = "idle" | "listening" | "thinking" | "executing" | "success" | "error";

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
  actionType: "send_email" | "update_crm" | "book_meeting";
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
}
