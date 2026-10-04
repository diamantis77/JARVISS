import { describe, expect, it, vi } from "vitest";
import { classifyMissionReply } from "../lib/missions/replies";
import { deterministicMissionBriefing, formatResearchOnlyBriefing, isResearchOnlyMission, MissionService, missionLocalClock, missionOutreachKey, missionWithinHours } from "../lib/missions/service";
import { dueMissionJobs } from "../lib/jobs/scheduler";
import { missionPhonePolicy } from "../lib/missions/notification-policy";
import { maybeQueueMissionOwnerNotification } from "../lib/missions/notifications";

describe("Daily Missions deterministic rules", () => {
  it("uses the owner's Athens date and configured working window", () => {
    const local = missionLocalClock(new Date("2026-09-23T06:15:00.000Z"), "Europe/Athens");
    expect(local).toEqual({ date: "2026-09-23", time: "09:15" });
    expect(missionWithinHours({ workStart: "09:00", workEnd: "20:30" }, "09:15")).toBe(true);
    expect(missionWithinHours({ workStart: "09:00", workEnd: "20:30" }, "20:30")).toBe(false);
    expect(missionWithinHours({ workStart: "22:00", workEnd: "02:00" }, "01:00")).toBe(true);
  });

  it("schedules one deduplicated work tick per local half-hour and one daily briefing", () => {
    const mission = { id: "mission-1", user_id: "owner-1", status: "active", timezone: "Europe/Athens", work_start: "09:00:00", work_end: "20:30:00", briefing_time: "20:30:00" };
    const first = dueMissionJobs(mission, new Date("2026-09-23T06:01:00Z"));
    const retry = dueMissionJobs(mission, new Date("2026-09-23T06:29:00Z"));
    expect(first).toHaveLength(1);
    expect(first[0].deduplicationKey).toBe(retry[0].deduplicationKey);
    expect(dueMissionJobs(mission, new Date("2026-09-23T17:30:00Z")).map((job) => job.jobType)).toEqual(["mission_brief"]);
    expect(dueMissionJobs({ ...mission, status: "paused" }, new Date("2026-09-23T06:01:00Z"))).toEqual([]);
    expect(dueMissionJobs({ ...mission, status: "paused" }, new Date("2026-09-23T17:31:00Z"))).toEqual([]);
    expect(dueMissionJobs({ ...mission, status: "stopped" }, new Date("2026-09-23T17:31:00Z"))).toEqual([]);
    expect(dueMissionJobs(mission, new Date("2026-09-23T00:15:00Z"))).toEqual([]);
  });

  it("summarizes only supplied persisted counts and never invents a success", () => {
    const summary = deterministicMissionBriefing({ discovered: 12, qualified: 3, outreachDrafts: 2, outreachSent: 0, replies: 1, interested: 0, meetings: 0, pendingApprovals: 2 });
    expect(summary).toContain("εντοπίστηκαν 12 επιχειρήσεις");
    expect(summary).toContain("0 εγκεκριμένα email");
    expect(summary).toContain("2 εγκρίσεις");
    expect(summary).not.toContain("ραντεβού κλείστηκαν");
  });

  it("keeps a research-only mission free of outreach drafts and schedules its 20:30 briefing", async () => {
    const mission: Parameters<MissionService["prepareOutreachDrafts"]>[0] = { id: "mission", userId: "owner", title: "Research", industry: "clinics", geography: "Greece", goal: "Research only", criteria: {}, dailyTargetLimit: 30, workStart: "09:00", workEnd: "20:00", briefingTime: "20:30", timezone: "Europe/Athens", status: "active", outreachMode: "DRAFT_ONLY", outreachPolicy: { researchOnly: true }, createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z" };
    expect(isResearchOnlyMission(mission)).toBe(true);
    const service = new MissionService({} as ConstructorParameters<typeof MissionService>[0], "owner");
    expect(await service.prepareOutreachDrafts(mission, "run")).toEqual({ drafted: 0, blocked: "research_only" });
    const scheduled = dueMissionJobs({ id: "mission", user_id: "owner", status: "active", timezone: "Europe/Athens", work_start: "09:00", work_end: "20:00", briefing_time: "20:30" }, new Date("2026-09-23T17:30:00Z"));
    expect(scheduled.map((job) => job.jobType)).toEqual(["mission_brief"]);
  });

  it("formats the research briefing only from measured counts and cited top leads", () => {
    const summary = formatResearchOnlyBriefing({ businessesChecked: 12, qualifiedLeads: 3, noOfficialSiteFound: 2, weakSite: 4, publicEmail: 2, publicPhone: 3, rejectedCandidates: 9, blockers: [], bestLeads: [{ name: "Clinic A", score: 85, reason: "No booking path detected on inspected pages.", evidenceUrls: ["https://clinic.example"] }] });
    expect(summary).toContain("Ελέγχθηκαν 12 επιχειρήσεις");
    expect(summary).toContain("δημόσιο email 2");
    expect(summary).toContain("Clinic A (85/100");
    expect(summary).toContain("https://clinic.example");
    expect(summary).not.toContain("email στάλθηκαν");
  });

  it("deduplicates exact outreach payloads and changes identity when the message changes", () => {
    const first = missionOutreachKey("mission", "target", "Person@Example.com", "Subject", "Body");
    expect(first).toBe(missionOutreachKey("mission", "target", "person@example.com", "Subject", "Body"));
    expect(first).not.toBe(missionOutreachKey("mission", "target", "person@example.com", "Subject", "Different body"));
  });

  it("classifies replies conservatively with opt-out precedence", () => {
    expect(classifyMissionReply("Re: proposal", "Please unsubscribe; I am interested in nothing.")).toBe("UNSUBSCRIBE");
    expect(classifyMissionReply("Απάντηση", "Δεν μας ενδιαφέρει.")).toBe("NOT_INTERESTED");
    expect(classifyMissionReply("Απάντηση", "Θέλω ένα ραντεβού.")).toBe("MEETING_REQUEST");
    expect(classifyMissionReply("Απάντηση", "Μας ενδιαφέρει.")).toBe("INTERESTED");
    expect(classifyMissionReply("Απάντηση", "Πόσο κοστίζει; ")).toBe("QUESTION");
    expect(classifyMissionReply("Απάντηση", "Θα το εξετάσουμε.")).toBe("UNCLEAR");
    expect(classifyMissionReply("Re: Interested in a meeting", "We will review your message.")).toBe("UNCLEAR");
  });

  it("keeps mission phone notifications off by default and enforces priority/cooldown", async () => {
    vi.stubEnv("MISSION_PHONE_NOTIFICATIONS_ENABLED", "false");
    const result = await maybeQueueMissionOwnerNotification({} as Parameters<typeof maybeQueueMissionOwnerNotification>[0], { userId: "owner", missionId: "mission", eventId: "event", eventType: "MISSION_REPLY_RECEIVED", priority: "HIGH" });
    expect(result).toEqual({ queued: false, reason: "feature_disabled" });
    vi.unstubAllEnvs();
    expect(missionPhonePolicy("NORMAL", true, true, null, 120).allowed).toBe(false);
    expect(missionPhonePolicy("HIGH", false, true, null, 120).allowed).toBe(false);
    expect(missionPhonePolicy("HIGH", true, true, "2026-09-23T10:00:00Z", 120, new Date("2026-09-23T10:30:00Z")).reason).toBe("cooldown");
    expect(missionPhonePolicy("URGENT", true, true, "2026-09-23T10:00:00Z", 120, new Date("2026-09-23T12:01:00Z")).allowed).toBe(true);
  });
});
