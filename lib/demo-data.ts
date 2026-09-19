import type { Activity, Approval, JarvisRun, Lead, LeadAnalysis, Task } from "../types";

export const demoLeads: Lead[] = [
  { id: "papadopoulos-dental", businessName: "Papadopoulos Dental", category: "Dental clinic", city: "Larissa", country: "Greece", website: null, email: "hello@papadopoulosdental.example", phone: "+30 2410 555 201", source: "demo", status: "qualified", score: 91, scoreReason: "Strong local presence with clear booking and website gaps.", opportunitySummary: "A conversion-focused clinic site with appointment booking.", reviewCount: 143, lastActivity: "12 min ago" },
  { id: "aegean-smile", businessName: "Aegean Smile Center", category: "Dental clinic", city: "Kos", country: "Greece", website: "https://aegeansmile.example", email: "care@aegeansmile.example", phone: null, source: "demo", status: "analyzed", score: 82, scoreReason: "Outdated mobile experience and weak enquiry path.", opportunitySummary: "Improve mobile booking journey and service pages.", reviewCount: 96, lastActivity: "34 min ago" },
  { id: "kos-derma", businessName: "Kos Derma Clinic", category: "Dermatology", city: "Kos", country: "Greece", website: "https://kosderma.example", email: "appointments@kosderma.example", phone: null, source: "demo", status: "qualified", score: 78, scoreReason: "Healthy review profile but no visible online booking.", opportunitySummary: "Introduce an appointment conversion flow.", reviewCount: 117, lastActivity: "1 hr ago" },
  { id: "larissa-cardio", businessName: "Larissa Cardiology Center", category: "Cardiology", city: "Larissa", country: "Greece", website: "https://larissacardio.example", email: null, phone: "+30 2410 555 612", source: "demo", status: "new", score: 69, scoreReason: "Limited web presence; more evidence needed.", opportunitySummary: "Run a verified presence review before outreach.", reviewCount: null, lastActivity: "2 hrs ago" },
];

export const demoAnalyses: Record<string, LeadAnalysis> = {
  "papadopoulos-dental": { leadId: "papadopoulos-dental", websiteQuality: "unknown", mobileQuality: "unknown", onlineBooking: "missing", ctaQuality: "unknown", onlinePresence: "strong", problems: ["No dedicated website identified", "No online appointment path identified"], opportunities: ["Launch a trusted, mobile-first clinic website", "Convert local discovery into appointment requests"], evidence: ["143 public reviews reported by demo source", "Dedicated website: not found in demo dataset", "Online booking: not identified in demo dataset"] },
  "aegean-smile": { leadId: "aegean-smile", websiteQuality: "needs_work", mobileQuality: "poor", onlineBooking: "missing", ctaQuality: "weak", onlinePresence: "strong", problems: ["Mobile journey needs attention", "Booking call-to-action is not identified"], opportunities: ["Simplify mobile booking", "Clarify high-value treatment pages"], evidence: ["96 public reviews reported by demo source", "Website assessment is demo data; verify before external outreach"] },
};

export const demoRun: JarvisRun = {
  id: "run_demo_larissa", request: "Show me the strongest fictional leads in my demo CRM.", status: "completed", summary: "I reviewed the 4 fictional CRM leads. Papadopoulos Dental has the highest stored demo score at 91.", currentStep: 3, createdAt: "Today, 13:04", steps: [
    { id: "step-1", order: 1, title: "Interpret request", description: "Identified dental clinics in Larissa", status: "completed", toolName: "plan_request", result: "Lead search workflow ready" },
    { id: "step-2", order: 2, title: "Search CRM", description: "4 fictional records reviewed", status: "completed", toolName: "search_crm", result: "Demo CRM only — no live web search" },
    { id: "step-3", order: 3, title: "Rank stored scores", description: "Compared the available demo evidence", status: "completed", toolName: "score_lead", result: "Papadopoulos Dental ranked first at 91" },
  ]
};

export const demoApproval: Approval = { id: "approval_1", runId: demoRun.id, actionType: "send_email", status: "pending", recipient: "Dr. Eleni Papadopoulos", subject: "A simple way to make booking easier for your clinic", preview: "I noticed Papadopoulos Dental has a strong local review presence, but patients do not appear to have a dedicated online booking path. I have a practical idea for a mobile-first clinic experience..." };
export const demoActivities: Activity[] = [
  { id: "a1", time: "13:20", eventType: "outreach", title: "Outreach draft created", description: "Papadopoulos Dental · awaiting review" },
  { id: "a2", time: "13:07", eventType: "score", title: "Lead score updated to 91", description: "Papadopoulos Dental · transparent scoring evidence saved" },
  { id: "a3", time: "13:04", eventType: "analysis", title: "Reviewed 4 fictional CRM leads", description: "Demo CRM ranking · no live research" },
];
export const demoTasks: Task[] = [
  { id: "t1", title: "Review Papadopoulos Dental outreach", leadId: "papadopoulos-dental", status: "open", priority: "high", due: "Today" },
  { id: "t2", title: "Verify Aegean Smile booking journey", leadId: "aegean-smile", status: "open", priority: "medium", due: "Tomorrow" },
];
