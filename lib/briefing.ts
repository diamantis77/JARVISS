import type { Activity, Approval, JarvisNotification, Lead, JarvisRun, Task } from "../types";
import type { WeatherSnapshot } from "./weather/contracts";
import { aggregateBusinessIntelligence } from "./business-intelligence";

export type BriefingPeriod = "morning" | "afternoon" | "evening" | "late";
export type BriefingLength = "short" | "normal";

export type BriefingPreferences = {
  enabled: boolean;
  length: BriefingLength;
  includeWeather: boolean;
  includeCalendar: boolean;
  includeBusiness: boolean;
  includeEmail: boolean;
};

export type BriefingSnapshot = {
  generatedAt: string;
  period: BriefingPeriod;
  newLeads: number;
  qualifiedLeads: number;
  hotLeads: number;
  importantReplies: number;
  meetings: number;
  pendingApprovals: number;
  overdueTasks: number;
  tasksDueToday: number;
  completedResearch: number;
  completedActions: number;
  draftsCreated: number;
  crmUpdates: number;
  pipelineValue: number | null;
  expectedRevenue: number | null;
  proposals: number;
  dealsNearClosing: number;
  actualRevenue: number | null;
  weather: WeatherSnapshot;
  priorities: Array<{ kind: "provider" | "meeting" | "reply" | "approval" | "task" | "deal"; label: string; reason: string }>;
  majorSignature: string;
};

const localDateKey = (date: Date, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const localHour = (date: Date, timezone: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(date));
const safeDate = (value?: string | null) => { const parsed = value ? new Date(value) : null; return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null; };
const isOnDate = (value: string | null | undefined, key: string, timezone: string) => { const date = safeDate(value); return date ? localDateKey(date, timezone) === key : false; };

export function getBriefingPeriod(now: Date, timezone: string): BriefingPeriod {
  const hour = localHour(now, timezone);
  return hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : hour >= 18 && hour < 23 ? "evening" : "late";
}

export function aggregateBriefing(input: { now: Date; timezone: string; leads: Lead[]; activities: Activity[]; tasks: Task[]; approvals: Approval[]; notifications: JarvisNotification[]; runs?: JarvisRun[]; weather: WeatherSnapshot }): BriefingSnapshot {
  const today = localDateKey(input.now, input.timezone);
  const nowMs = input.now.getTime();
  const todayActivities = input.activities.filter((item) => isOnDate(item.time, today, input.timezone));
  const activeNotifications = input.notifications.filter((item) => !item.dismissedAt);
  const todayNotifications = activeNotifications.filter((item) => isOnDate(item.createdAt, today, input.timezone));
  const openTasks = input.tasks.filter((task) => task.status === "open");
  const overdueTasks = openTasks.filter((task) => { const due = safeDate(task.due); return Boolean(due && due.getTime() < nowMs && !isOnDate(task.due, today, input.timezone)); }).length;
  const tasksDueToday = openTasks.filter((task) => isOnDate(task.due, today, input.timezone)).length;
  const financial = aggregateBusinessIntelligence(input.leads);
  const importantReplies = todayNotifications.filter((item) => ["EMAIL_REPLY", "HOT_LEAD_REPLY"].includes(item.type) && ["important", "urgent"].includes(item.priority)).length;
  const meetings = todayNotifications.filter((item) => ["MEETING_REQUEST", "UPCOMING_MEETING"].includes(item.type)).length;
  const providerFailure = activeNotifications.find((item) => item.type === "PROVIDER_ERROR" && item.priority === "urgent");
  const importantReply = activeNotifications.find((item) => item.type === "HOT_LEAD_REPLY" || (item.type === "EMAIL_REPLY" && item.priority === "urgent"));
  const meetingSoon = activeNotifications.find((item) => item.type === "UPCOMING_MEETING" && ["important", "urgent"].includes(item.priority));
  const priorities: BriefingSnapshot["priorities"] = [];
  if (providerFailure) priorities.push({ kind: "provider", label: providerFailure.title, reason: "Επείγουσα αποτυχία provider" });
  if (meetingSoon) priorities.push({ kind: "meeting", label: meetingSoon.title, reason: "Meeting σύντομα" });
  if (importantReply) priorities.push({ kind: "reply", label: importantReply.title, reason: "Σημαντική απάντηση" });
  for (const approval of input.approvals.slice(0, 2)) priorities.push({ kind: "approval", label: approval.subject || "Εκκρεμής έγκριση", reason: "Μπλοκάρει εξωτερική ενέργεια" });
  for (const task of openTasks.filter((item) => item.priority === "high").slice(0, 2)) priorities.push({ kind: "task", label: task.title, reason: isOnDate(task.due, today, input.timezone) ? "Λήγει σήμερα" : "Υψηλή προτεραιότητα" });
  for (const lead of financial.closeToClosing.slice(0, 2)) priorities.push({ kind: "deal", label: lead.businessName, reason: "Deal κοντά στο κλείσιμο" });

  const completedResearch = todayActivities.filter((item) => /research|έρευν/i.test(`${item.title} ${item.description}`) && /complete|ολοκληρ/i.test(`${item.title} ${item.description}`)).length;
  const draftsCreated = todayActivities.filter((item) => /draft|προσχέδι/i.test(`${item.title} ${item.description}`)).length;
  const crmUpdates = todayActivities.filter((item) => /lead updated|crm|ενημέρωση lead/i.test(`${item.title} ${item.description}`)).length;
  const completedActions = todayActivities.filter((item) => !/started|ξεκίνη/i.test(item.title)).length;
  const newLeads = input.leads.filter((lead) => lead.status === "new" && isOnDate(lead.lastActivity, today, input.timezone)).length;
  const qualifiedLeads = input.leads.filter((lead) => lead.status === "qualified").length;
  const hotLeads = input.leads.filter((lead) => lead.score >= 80).length;
  const actualRevenue = financial.closedRevenue !== null && financial.closedRevenue > 0 ? financial.closedRevenue : null;
  const pipelineValue = financial.hasFinancialData ? financial.pipelineValue : null;
  const expectedRevenue = financial.hasFinancialData ? financial.expectedRevenue : null;
  const majorSignature = [importantReplies, meetings, input.approvals.length, overdueTasks, providerFailure?.id ?? "", newLeads].join(":");
  return { generatedAt: input.now.toISOString(), period: getBriefingPeriod(input.now, input.timezone), newLeads, qualifiedLeads, hotLeads, importantReplies, meetings, pendingApprovals: input.approvals.length, overdueTasks, tasksDueToday, completedResearch, completedActions, draftsCreated, crmUpdates, pipelineValue, expectedRevenue, proposals: financial.openProposals, dealsNearClosing: financial.closeToClosing.length, actualRevenue, weather: input.weather, priorities: priorities.slice(0, 5), majorSignature };
}

const countPhrase = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;

export function formatSpokenBriefing(snapshot: BriefingSnapshot, input: { address: string; preferences: BriefingPreferences }) {
  const address = input.address.trim() || "κύριε";
  const greeting = snapshot.period === "morning" ? "Καλημέρα" : snapshot.period === "afternoon" ? "Καλό απόγευμα" : snapshot.period === "evening" ? "Καλησπέρα" : "Είμαι εδώ";
  if (!input.preferences.enabled) return `${greeting} ${address}. Σας ακούω.`;
  const facts: string[] = [];
  if (snapshot.newLeads) facts.push(`εντόπισα ${countPhrase(snapshot.newLeads, "νέο lead", "νέα leads")}`);
  if (snapshot.hotLeads) facts.push(`${countPhrase(snapshot.hotLeads, "lead έχει", "leads έχουν")} score πάνω από 80`);
  if (input.preferences.includeEmail && snapshot.importantReplies) facts.push(`έχετε ${countPhrase(snapshot.importantReplies, "σημαντική απάντηση", "σημαντικές απαντήσεις")}`);
  if (input.preferences.includeCalendar && snapshot.meetings) facts.push(`έχετε ${countPhrase(snapshot.meetings, "meeting", "meetings")} σήμερα`);
  if (snapshot.pendingApprovals) facts.push(`${countPhrase(snapshot.pendingApprovals, "έγκριση είναι", "εγκρίσεις είναι")} σε αναμονή`);
  if (snapshot.overdueTasks) facts.push(`${countPhrase(snapshot.overdueTasks, "εργασία είναι εκπρόθεσμη", "εργασίες είναι εκπρόθεσμες")}`);
  if (input.preferences.includeBusiness && snapshot.dealsNearClosing) facts.push(`${countPhrase(snapshot.dealsNearClosing, "deal είναι", "deals είναι")} κοντά στο κλείσιμο`);
  const limit = input.preferences.length === "short" || snapshot.period === "late" ? 3 : 5;
  let text = `${greeting} ${address}.`;
  if (facts.length) text += ` ${facts.slice(0, limit).join(". ")}.`;
  else text += " Δεν υπάρχει κάποια νέα κρίσιμη ενημέρωση αυτή τη στιγμή.";
  if (input.preferences.includeWeather && snapshot.weather.status === "available") {
    text += ` Στη ${snapshot.weather.location} έχει ${Math.round(snapshot.weather.temperatureC)} βαθμούς και ${snapshot.weather.condition.toLocaleLowerCase("el-GR")}.`;
  }
  if (snapshot.period !== "late" && facts.length) text += " Θέλετε να ξεκινήσω με τη σημαντικότερη ενημέρωση;";
  return text;
}

export function shouldDeliverFullBriefing(input: { snapshot: BriefingSnapshot; lastBriefingAt?: string | null; lastBriefingPeriod?: string | null }) {
  const last = safeDate(input.lastBriefingAt);
  if (!last) return true;
  const sameDay = last.toISOString().slice(0, 10) === input.snapshot.generatedAt.slice(0, 10);
  return !sameDay || input.lastBriefingPeriod !== input.snapshot.period;
}

export function formatTodayActivity(snapshot: BriefingSnapshot) {
  const facts: string[] = [];
  if (snapshot.completedResearch) facts.push(`ολοκλήρωσα ${countPhrase(snapshot.completedResearch, "research run", "research runs")}`);
  if (snapshot.crmUpdates) facts.push(`έκανα ${countPhrase(snapshot.crmUpdates, "ενημέρωση CRM", "ενημερώσεις CRM")}`);
  if (snapshot.draftsCreated) facts.push(`δημιούργησα ${countPhrase(snapshot.draftsCreated, "draft", "drafts")}`);
  if (!facts.length && snapshot.completedActions) facts.push(`κατέγραψα ${countPhrase(snapshot.completedActions, "ολοκληρωμένη ενέργεια", "ολοκληρωμένες ενέργειες")}`);
  return facts.length ? `Σήμερα ${facts.join(", ")}.` : "Δεν υπάρχουν καταγεγραμμένες ολοκληρωμένες ενέργειες για σήμερα.";
}
