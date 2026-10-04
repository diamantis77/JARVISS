import { describe, expect, it } from "vitest";
import { aggregateBriefing, formatSpokenBriefing, formatTodayActivity, getBriefingPeriod, shouldDeliverFullBriefing } from "../lib/briefing";
import type { Activity, Approval, JarvisNotification, Lead, Task } from "../types";

const now = new Date("2026-09-21T08:00:00.000Z");
const lead = (patch: Partial<Lead> = {}): Lead => ({ id: "l1", businessName: "Example Dental", category: "Dental", city: "Λάρισα", country: "Ελλάδα", website: null, email: null, phone: null, source: "provider", status: "new", score: 85, scoreReason: "stored", opportunitySummary: "stored", reviewCount: null, lastActivity: "2026-09-21T07:00:00.000Z", ...patch });
const activity = (patch: Partial<Activity> = {}): Activity => ({ id: "a1", time: "2026-09-21T07:30:00.000Z", eventType: "analysis", title: "Research completed", description: "Completed", ...patch });
const task = (patch: Partial<Task> = {}): Task => ({ id: "t1", title: "Απάντηση προσφοράς", status: "open", priority: "high", due: "2026-09-21T12:00:00.000Z", ...patch });
const approval = (patch: Partial<Approval> = {}): Approval => ({ id: "p1", runId: "r", actionType: "send_email", status: "pending", recipient: "customer@example.com", subject: "Προσφορά", preview: "Stored", ...patch });
const notification = (patch: Partial<JarvisNotification> = {}): JarvisNotification => ({ id: "n1", type: "HOT_LEAD_REPLY", priority: "urgent", title: "Νέα απάντηση", body: "Stored", entityType: "lead", entityId: "l1", readAt: null, dismissedAt: null, metadata: {}, createdAt: "2026-09-21T07:45:00.000Z", ...patch });

describe("deterministic personal briefing", () => {
  it("aggregates only stored records and ranks structured priorities", () => {
    const snapshot = aggregateBriefing({ now, timezone: "Europe/Athens", leads: [lead()], activities: [activity()], tasks: [task()], approvals: [approval()], notifications: [notification()], weather: { status: "unavailable", location: null, reason: "missing_location" } });
    expect(snapshot).toMatchObject({ newLeads: 1, hotLeads: 1, importantReplies: 1, pendingApprovals: 1, completedResearch: 1 });
    expect(snapshot.priorities.map((item) => item.kind)).toEqual(["reply", "approval", "task"]);
    expect(formatTodayActivity(snapshot)).toContain("research run");
  });

  it("suppresses a repeated full briefing in the same period", () => {
    const snapshot = aggregateBriefing({ now, timezone: "Europe/Athens", leads: [], activities: [], tasks: [], approvals: [], notifications: [], weather: { status: "unavailable", location: null, reason: "missing_location" } });
    expect(shouldDeliverFullBriefing({ snapshot, lastBriefingAt: null, lastBriefingPeriod: null })).toBe(true);
    expect(shouldDeliverFullBriefing({ snapshot, lastBriefingAt: "2026-09-21T07:55:00.000Z", lastBriefingPeriod: snapshot.period })).toBe(false);
  });

  it("uses time-of-day greetings and does not invent weather or revenue", () => {
    expect(getBriefingPeriod(new Date("2026-09-21T05:00:00Z"), "Europe/Athens")).toBe("morning");
    expect(getBriefingPeriod(new Date("2026-09-21T13:00:00Z"), "Europe/Athens")).toBe("afternoon");
    const snapshot = aggregateBriefing({ now, timezone: "Europe/Athens", leads: [lead({ estimatedValue: null, actualRevenue: null })], activities: [], tasks: [], approvals: [], notifications: [], weather: { status: "unavailable", location: null, reason: "missing_location" } });
    const spoken = formatSpokenBriefing(snapshot, { address: "κύριε", preferences: { enabled: true, length: "short", includeWeather: true, includeCalendar: true, includeBusiness: true, includeEmail: true } });
    expect(snapshot.pipelineValue).toBeNull();
    expect(snapshot.actualRevenue).toBeNull();
    expect(spoken).not.toMatch(/βαθμ|€|ευρώ/i);
  });
});
