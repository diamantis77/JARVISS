import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseJobQueue } from "../jobs/supabase-queue";
import { maybeQueueMissionOwnerNotification } from "./notifications";
import { generateGreekOutreach } from "../email/generate-greek-outreach";
import { manualOutreachBlockReason } from "../email/manual-outreach";

export type MissionStatus = "active" | "paused" | "stopped";
export type OutreachMode = "DRAFT_ONLY" | "APPROVAL_REQUIRED" | "PREAPPROVED_CAMPAIGN";
export interface Mission {
  id: string; userId: string; title: string; industry: string; geography: string; goal: string;
  criteria: Record<string, unknown>; dailyTargetLimit: number; workStart: string; workEnd: string;
  briefingTime: string; timezone: string; status: MissionStatus; outreachMode: OutreachMode;
  outreachPolicy: Record<string, unknown>; createdAt: string; updatedAt: string;
}
export interface MissionMetrics {
  discovered: number; qualified: number; outreachDrafts: number; outreachSent: number;
  replies: number; interested: number; meetings: number; pendingApprovals: number;
}

const schemaMissing = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /mission(s|_runs).*not found/i.test(error.message ?? "")));
const required = <T>(data: T | null, error: { message?: string } | null, operation: string): T => {
  if (error || !data) throw new Error(`${operation} failed`);
  return data;
};
const mapMission = (row: Record<string, unknown>): Mission => ({
  id: String(row.id), userId: String(row.user_id), title: String(row.title), industry: String(row.industry),
  geography: String(row.geography), goal: String(row.goal), criteria: (row.criteria_json ?? {}) as Record<string, unknown>,
  dailyTargetLimit: Number(row.daily_target_limit), workStart: String(row.work_start), workEnd: String(row.work_end),
  briefingTime: String(row.briefing_time), timezone: String(row.timezone), status: row.status as MissionStatus,
  outreachMode: row.outreach_mode as OutreachMode, outreachPolicy: (row.outreach_policy_json ?? {}) as Record<string, unknown>,
  createdAt: String(row.created_at), updatedAt: String(row.updated_at),
});

export function missionLocalClock(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function missionWithinHours(mission: Pick<Mission, "workStart" | "workEnd">, time: string) {
  const start = mission.workStart.slice(0, 5), end = mission.workEnd.slice(0, 5);
  return start <= end ? time >= start && time < end : time >= start || time < end;
}

export function deterministicMissionBriefing(metrics: MissionMetrics) {
  return `Σήμερα εντοπίστηκαν ${metrics.discovered} επιχειρήσεις, ${metrics.qualified} πληρούν τα κριτήρια, ${metrics.outreachSent} εγκεκριμένα email στάλθηκαν, ελήφθησαν ${metrics.replies} απαντήσεις, ${metrics.interested} δείχνουν ενδιαφέρον και ${metrics.meetings} ραντεβού καταχωρίστηκαν. Εκκρεμούν ${metrics.pendingApprovals} εγκρίσεις.`;
}

export function isResearchOnlyMission(mission: Pick<Mission, "outreachPolicy">) {
  return mission.outreachPolicy.researchOnly === true;
}

export interface ResearchOnlyBriefingMetrics {
  businessesChecked: number; qualifiedLeads: number; noOfficialSiteFound: number; weakSite: number;
  publicEmail: number; publicPhone: number; rejectedCandidates: number; blockers: string[];
  bestLeads: Array<{ name: string; score: number; reason: string; evidenceUrls: string[] }>;
}

export function formatResearchOnlyBriefing(metrics: ResearchOnlyBriefingMetrics) {
  const lines = [
    `Ελέγχθηκαν ${metrics.businessesChecked} επιχειρήσεις · qualified ${metrics.qualifiedLeads} · χωρίς επίσημο site που να βρέθηκε ${metrics.noOfficialSiteFound} · ασθενές site ${metrics.weakSite}.`,
    `Qualified leads με δημόσιο email ${metrics.publicEmail} · με δημόσιο τηλέφωνο ${metrics.publicPhone} · μη qualified/αποτυχημένοι υποψήφιοι ${metrics.rejectedCandidates}.`,
    `Εμπόδια/σφάλματα: ${metrics.blockers.length ? metrics.blockers.join("; ") : "κανένα καταγεγραμμένο"}.`,
  ];
  if (metrics.bestLeads.length) lines.push(`Καλύτερα ${metrics.bestLeads.length}: ${metrics.bestLeads.map((lead) => `${lead.name} (${lead.score}/100; ${lead.reason}; πηγή: ${lead.evidenceUrls[0] ?? "μη διαθέσιμη"})`).join(" | ")}`);
  else lines.push("Δεν υπάρχουν τεκμηριωμένα qualified leads για κατάταξη σήμερα.");
  return lines.join("\n");
}

export class MissionService {
  constructor(private readonly db: SupabaseClient, private readonly userId: string) {}

  async schemaReady() {
    const { error } = await this.db.from("missions").select("id").eq("user_id", this.userId).limit(1);
    if (!error) return true;
    if (schemaMissing(error)) return false;
    throw new Error("Mission database health check failed");
  }

  async list() {
    const { data, error } = await this.db.from("missions").select("*").eq("user_id", this.userId).order("created_at", { ascending: false });
    if (error) throw new Error("Unable to list missions");
    return (data ?? []).map((row) => mapMission(row));
  }

  async get(id: string) {
    const { data, error } = await this.db.from("missions").select("*").eq("id", id).eq("user_id", this.userId).maybeSingle();
    if (error) throw new Error("Unable to read mission");
    return data ? mapMission(data) : null;
  }

  async create(input: { title: string; industry: string; geography: string; goal: string; criteria?: Record<string, unknown>; dailyTargetLimit: number; workStart?: string; workEnd?: string; briefingTime?: string; timezone?: string; outreachMode?: OutreachMode; senderIdentity?: string; researchOnly?: boolean }) {
    const row = {
      user_id: this.userId, title: input.title, industry: input.industry, geography: input.geography, goal: input.goal,
      criteria_json: input.criteria ?? {},
      daily_target_limit: input.dailyTargetLimit, work_start: input.workStart ?? "09:00", work_end: input.workEnd ?? "20:30",
      briefing_time: input.briefingTime ?? "20:30", timezone: input.timezone ?? "Europe/Athens",
      outreach_mode: input.researchOnly ? "DRAFT_ONLY" : input.outreachMode ?? "APPROVAL_REQUIRED", outreach_policy_json: input.researchOnly ? { researchOnly: true } : input.senderIdentity ? { senderIdentity: input.senderIdentity } : {}, status: "paused",
    };
    const { data, error } = await this.db.from("missions").insert(row).select().single();
    return mapMission(required(data, error, "missions.create"));
  }

  async setStatus(id: string, status: MissionStatus) {
    const existing = await this.get(id);
    if (!existing) throw new Error("Mission not found");
    if (existing.status === "stopped" && status !== "stopped") throw new Error("Stopped missions cannot be resumed");
    const { data, error } = await this.db.from("missions").update({ status }).eq("id", id).eq("user_id", this.userId).select().single();
    const mission = mapMission(required(data, error, "missions.setStatus"));
    await this.recordEvent(id, `status:${status}:${mission.updatedAt}`, "MISSION_STATUS_CHANGED", "NORMAL", { status });
    return mission;
  }

  async recordEvent(missionId: string, sourceKey: string, eventType: string, priority: "LOW" | "NORMAL" | "HIGH" | "URGENT", metadata: Record<string, unknown> = {}, missionRunId?: string, suppressPhoneNotification = false) {
    const row = { user_id: this.userId, mission_id: missionId, mission_run_id: missionRunId ?? null, source_key: sourceKey, event_type: eventType, priority, metadata_json: metadata };
    const { data, error } = await this.db.from("mission_events").upsert(row, { onConflict: "mission_id,source_key", ignoreDuplicates: true }).select("id").maybeSingle();
    if (error) throw new Error("Unable to record mission event");
    if (data && !suppressPhoneNotification && (priority === "HIGH" || priority === "URGENT") && !isResearchOnlyMission(required(await this.get(missionId), null, "missions.notificationPolicy"))) {
      // Phone dispatch has three independent gates: deployment opt-in, an
      // explicit owner rule, and the existing owner-only phone policy.
      try {
        await maybeQueueMissionOwnerNotification(this.db, { userId: this.userId, missionId, eventId: data.id, eventType, priority });
      } catch {
        // Persist the business event even if optional phone notification is
        // unavailable. Never retry an ambiguous phone dispatch automatically.
        await this.db.from("mission_events").update({ phone_dispatch_status: "unknown" }).eq("id", data.id).eq("user_id", this.userId);
      }
    }
  }

  async metrics(missionId: string, localDate: string): Promise<MissionMetrics> {
    const mission = await this.get(missionId);
    if (!mission) throw new Error("Mission not found");
    const run = await this.db.from("mission_runs").select("id").eq("user_id", this.userId).eq("mission_id", missionId).eq("local_date", localDate).maybeSingle();
    if (run.error) throw new Error("Unable to read mission run");
    const day = new Date(`${localDate}T00:00:00Z`).getTime();
    const lower = new Date(day - 86_400_000).toISOString();
    const upper = new Date(day + 2 * 86_400_000).toISOString();
    const [targets, outreach, replies, appointments] = await Promise.all([
      run.data ? this.db.from("mission_targets").select("id,status").eq("user_id", this.userId).eq("mission_run_id", run.data.id) : Promise.resolve({ data: [] as Array<{ id: string; status: string }>, error: null }),
      this.db.from("mission_outreach").select("id,status,created_at,sent_at").eq("user_id", this.userId).eq("mission_id", missionId),
      this.db.from("mission_replies").select("id,classification,received_at,outreach_id,mission_outreach!inner(mission_id)").eq("user_id", this.userId).eq("mission_outreach.mission_id", missionId).gte("received_at", lower).lt("received_at", upper),
      this.db.from("mission_appointments").select("id,status,created_at,mission_opportunities!inner(mission_id)").eq("user_id", this.userId).eq("mission_opportunities.mission_id", missionId).gte("created_at", lower).lt("created_at", upper),
    ]);
    if ([targets.error, outreach.error, replies.error, appointments.error].some(Boolean)) throw new Error("Unable to calculate mission metrics");
    const repliesToday = (replies.data ?? []).filter((item) => missionLocalClock(new Date(item.received_at), mission.timezone).date === localDate);
    const appointmentsToday = (appointments.data ?? []).filter((item) => missionLocalClock(new Date(item.created_at), mission.timezone).date === localDate);
    const outreachToday = (outreach.data ?? []).filter((item) => missionLocalClock(new Date(item.created_at), mission.timezone).date === localDate);
    return {
      discovered: targets.data?.length ?? 0,
      qualified: targets.data?.filter((item) => ["qualified", "contacted", "replied", "interested", "meeting"].includes(item.status)).length ?? 0,
      outreachDrafts: outreachToday.filter((item) => item.status === "draft" || item.status === "pending_approval").length,
      outreachSent: outreach.data?.filter((item) => item.status === "sent" && item.sent_at && missionLocalClock(new Date(item.sent_at), mission.timezone).date === localDate).length ?? 0,
      replies: repliesToday.length,
      interested: repliesToday.filter((item) => item.classification === "INTERESTED").length,
      meetings: appointmentsToday.filter((item) => item.status === "booked").length,
      pendingApprovals: outreach.data?.filter((item) => item.status === "pending_approval").length ?? 0,
    };
  }

  async snapshot(mission: Mission, now = new Date()) {
    const local = missionLocalClock(now, mission.timezone);
    const [run, events, briefing, outreach, notificationRules, metrics] = await Promise.all([
      this.db.from("mission_runs").select("id,status,started_at,updated_at,research_run_id,last_error_category").eq("user_id", this.userId).eq("mission_id", mission.id).eq("local_date", local.date).maybeSingle(),
      this.db.from("mission_events").select("id,event_type,priority,phone_dispatch_status,created_at").eq("user_id", this.userId).eq("mission_id", mission.id).order("created_at", { ascending: false }).limit(10),
      this.db.from("mission_daily_briefings").select("summary,metrics_json,generated_at").eq("user_id", this.userId).eq("mission_id", mission.id).eq("local_date", local.date).maybeSingle(),
      this.db.from("mission_outreach").select("id,status,recipient_email,subject,body,created_at").eq("user_id", this.userId).eq("mission_id", mission.id).in("status", ["draft", "pending_approval"]).order("created_at", { ascending: false }).limit(20),
      this.db.from("mission_notification_rules").select("priority,dashboard_enabled,phone_enabled,cooldown_minutes").eq("user_id", this.userId).eq("mission_id", mission.id),
      this.metrics(mission.id, local.date),
    ]);
    if (run.error || events.error || briefing.error || outreach.error || notificationRules.error) throw new Error("Unable to read mission snapshot");
    return { mission, localDate: local.date, run: run.data, metrics, events: events.data ?? [], briefing: briefing.data, outreach: outreach.data ?? [], notificationRules: notificationRules.data ?? [], nextAction: mission.status === "paused" ? "Resume mission" : mission.status === "stopped" ? "Stopped" : !run.data ? "Scheduled research" : run.data.status === "failed" ? "Review failure" : run.data.status === "partial" ? "Continue research" : "Review qualified leads" };
  }

  async tick(missionId: string, now = new Date()) {
    const mission = await this.get(missionId);
    if (!mission || mission.status !== "active") return { skipped: "mission_not_active" };
    const local = missionLocalClock(now, mission.timezone);
    if (!missionWithinHours(mission, local.time)) return { skipped: "outside_working_hours" };
    const initial = await this.db.from("mission_runs").upsert({ user_id: this.userId, mission_id: mission.id, local_date: local.date, status: "pending" }, { onConflict: "mission_id,local_date", ignoreDuplicates: true });
    if (initial.error) throw new Error("Unable to create daily mission run");
    const runQuery = await this.db.from("mission_runs").select("*").eq("user_id", this.userId).eq("mission_id", mission.id).eq("local_date", local.date).single();
    const run = required(runQuery.data, runQuery.error, "mission_runs.read");
    if (run.status === "completed" || run.status === "paused" || run.status === "failed") return { skipped: run.status };
    let researchRunId = typeof run.research_run_id === "string" ? run.research_run_id : null;
    if (!researchRunId) {
      const claim = await this.db.from("mission_runs").update({ status: "running", started_at: run.started_at ?? now.toISOString() })
        .eq("id", run.id).eq("user_id", this.userId).eq("status", "pending").is("research_run_id", null).select("id").maybeSingle();
      if (claim.error) throw new Error("Unable to claim mission run");
      if (!claim.data) return { skipped: "already_claimed" };
      const [{ createSupabaseRepositories }, { createResearchService }] = await Promise.all([import("../repositories/supabase"), import("../research/factory")]);
      const repositories = createSupabaseRepositories(this.db, this.userId);
      const research = createResearchService(repositories, "live", this.userId);
      if (!research.available) {
        await this.db.from("mission_runs").update({ status: "failed", last_error_category: "research_unavailable" }).eq("id", run.id).eq("user_id", this.userId);
        await this.recordEvent(mission.id, `research-unavailable:${local.date}`, "MISSION_BLOCKED", "HIGH", { category: "research_unavailable" }, run.id);
        return { skipped: "research_unavailable" };
      }
      let result: Awaited<ReturnType<typeof research.start>>;
      try {
        result = await research.start({ jarvisRunId: null, industry: mission.industry, location: mission.geography, limit: mission.dailyTargetLimit, criteria: mission.criteria });
      } catch (error) {
        await this.db.from("mission_runs").update({ status: "failed", last_error_category: "research_failed" }).eq("id", run.id).eq("user_id", this.userId);
        await this.recordEvent(mission.id, `research-failed:${local.date}`, "MISSION_BLOCKED", "HIGH", { category: "research_failed" }, run.id);
        throw error;
      }
      researchRunId = result.researchRunId;
      const status = result.status === "failed" ? "failed" : result.status === "completed" ? "completed" : "partial";
      await this.db.from("mission_runs").update({ research_run_id: researchRunId || null, status, started_at: run.started_at ?? now.toISOString(), completed_at: status === "completed" ? new Date().toISOString() : null }).eq("id", run.id).eq("user_id", this.userId);
      await this.recordEvent(mission.id, `research-start:${local.date}`, "MISSION_RESEARCH_STARTED", "NORMAL", { researchRunId }, run.id);
    }
    if (researchRunId) {
      await this.syncTargets(mission, run.id, researchRunId);
      const progress = await this.db.from("research_runs").select("status,processed_count").eq("id", researchRunId).eq("user_id", this.userId).maybeSingle();
      if (progress.error) throw new Error("Unable to read mission research progress");
      if (progress.data?.status === "partial") {
        const queued = await this.db.from("background_jobs").select("id").eq("user_id", this.userId).eq("job_type", "research_continue")
          .contains("payload", { researchRunId }).in("status", ["pending", "scheduled", "running", "retrying"]).limit(1);
        if (queued.error) throw new Error("Unable to inspect mission continuation queue");
        if (!queued.data?.length) {
          const halfHourWindow = Math.floor((Number(local.time.slice(0, 2)) * 60 + Number(local.time.slice(3, 5))) / 30);
          await new SupabaseJobQueue(this.db).enqueue({ userId: this.userId, jobType: "research_continue", priority: 35,
            deduplicationKey: `mission-resume:${run.id}:${local.date}:${halfHourWindow}:${progress.data.processed_count}`,
            payload: { researchRunId, missionRunId: run.id }, correlationId: randomUUID() });
        }
      }
    }
    return { missionId: mission.id, runId: run.id, researchRunId };
  }

  async syncTargets(mission: Mission, missionRunId: string, researchRunId: string) {
    const candidates = await this.db.from("research_candidates").select("id,normalized_key,lead_id,status").eq("user_id", this.userId).eq("research_run_id", researchRunId);
    if (candidates.error) throw new Error("Unable to read researched candidates");
    for (const candidate of candidates.data ?? []) {
      const status = candidate.status === "qualified" ? "qualified" : candidate.status === "analyzed" ? "analyzed" : "discovered";
      const row = { user_id: this.userId, mission_id: mission.id, mission_run_id: missionRunId, normalized_key: candidate.normalized_key, lead_id: candidate.lead_id, source_candidate_id: candidate.id, status };
      const inserted = await this.db.from("mission_targets").upsert(row, { onConflict: "mission_id,normalized_key", ignoreDuplicates: true });
      if (inserted.error) throw new Error("Unable to persist mission target");
      if (status !== "discovered") {
        // Research advances a target, but never reopens a contacted, declined,
        // interested, or do-not-contact record after a scheduler retry.
        const advanced = await this.db.from("mission_targets").update({ status, lead_id: candidate.lead_id, source_candidate_id: candidate.id })
          .eq("user_id", this.userId).eq("mission_id", mission.id).eq("normalized_key", candidate.normalized_key)
          .in("status", ["discovered", "analyzed"]);
        if (advanced.error) throw new Error("Unable to advance researched target");
      }
    }
    const research = await this.db.from("research_runs").select("status").eq("id", researchRunId).eq("user_id", this.userId).maybeSingle();
    if (research.error) throw new Error("Unable to read research completion");
    if (research.data?.status === "completed") {
      await this.db.from("mission_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", missionRunId).eq("user_id", this.userId);
      await this.recordEvent(mission.id, `research-complete:${missionRunId}`, "MISSION_RESEARCH_COMPLETED", "NORMAL", {}, missionRunId);
      const latest = await this.get(mission.id);
      if (latest?.status === "active" && !isResearchOnlyMission(latest)) await this.prepareOutreachDrafts(latest, missionRunId);
    }
  }

  async prepareOutreachDrafts(mission: Mission, missionRunId: string) {
    if (isResearchOnlyMission(mission)) return { drafted: 0, blocked: "research_only" };
    if (mission.status !== "active") return { drafted: 0, blocked: "mission_not_active" };
    const senderIdentity = typeof mission.outreachPolicy.senderIdentity === "string" ? mission.outreachPolicy.senderIdentity.trim() : "";
    if (!senderIdentity) {
      await this.recordEvent(mission.id, `outreach-blocked:${missionRunId}`, "MISSION_OUTREACH_BLOCKED", "NORMAL", { category: "sender_identity_missing" }, missionRunId);
      return { drafted: 0, blocked: "sender_identity_missing" };
    }
    const targets = await this.db.from("mission_targets").select("id,lead_id,status").eq("user_id", this.userId).eq("mission_run_id", missionRunId).eq("status", "qualified");
    if (targets.error) throw new Error("Unable to read qualified mission targets");
    const { createSupabaseRepositories } = await import("../repositories/supabase");
    const repositories = createSupabaseRepositories(this.db, this.userId);
    const settings = await repositories.settings.get();
    let drafted = 0;
    for (const target of targets.data ?? []) {
      if (!target.lead_id) continue;
      const lead = await repositories.leads.getById(target.lead_id);
      if (!lead?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) continue;
      if (!/greece|ελλάδ/iu.test(lead.country)) continue;
      const suppressed = await this.db.from("contact_suppressions").select("id").eq("user_id", this.userId).eq("normalized_email", lead.email.trim().toLowerCase()).maybeSingle();
      if (suppressed.error) throw new Error("Unable to verify contact suppression");
      if (suppressed.data) continue;
      const [claims, interactions] = await Promise.all([repositories.evidence.listEvidenceForLead(lead.id), repositories.interactions.listForLead(lead.id)]);
      if (manualOutreachBlockReason(interactions)) continue;
      const evidence = claims.filter((item) => item.confidence === "verified" || item.confidence === "high" || item.confidence === "medium").slice(0, 12).map((item) => ({ id: item.id, confidence: item.confidence as "verified" | "high" | "medium", fact: `${item.fieldName}: ${item.valueText}; ${item.evidenceSummary}`.slice(0, 450) }));
      if (!evidence.length) continue;
      let suggestion;
      try {
        suggestion = await generateGreekOutreach({ businessName: lead.businessName, category: lead.category, city: lead.city, country: lead.country, evidence, previousContact: interactions.slice(0, 6).map((item) => ({ direction: item.direction, status: item.status, subject: item.subject, createdAt: item.createdAt })), offeredServices: settings.companyServices, senderName: senderIdentity, followUp: interactions.some((item) => item.channel === "email" && item.direction === "outbound" && item.status === "sent") });
      } catch {
        await this.recordEvent(mission.id, `outreach-draft-blocked:${target.id}`, "MISSION_OUTREACH_BLOCKED", "NORMAL", { category: "personalized_draft_unavailable", targetId: target.id }, missionRunId);
        continue;
      }
      const payloadHash = missionOutreachKey(mission.id, target.id, lead.email, suggestion.subject, suggestion.email);
      const inserted = await this.db.from("mission_outreach").upsert({ user_id: this.userId, mission_id: mission.id, target_id: target.id, status: "draft", recipient_email: lead.email, subject: suggestion.subject, body: suggestion.email, payload_hash: payloadHash }, { onConflict: "target_id", ignoreDuplicates: true }).select("id");
      if (inserted.error) throw new Error("Unable to save outreach draft");
      if (inserted.data?.length) drafted += 1;
    }
    if (drafted) await this.recordEvent(mission.id, `outreach-drafts:${missionRunId}`, "MISSION_OUTREACH_DRAFTED", "NORMAL", { count: drafted }, missionRunId);
    return { drafted, blocked: null };
  }

  private async researchOnlyBriefing(mission: Mission, localDate: string): Promise<ResearchOnlyBriefingMetrics> {
    const run = await this.db.from("mission_runs").select("research_run_id,last_error_category,status")
      .eq("user_id", this.userId).eq("mission_id", mission.id).eq("local_date", localDate).maybeSingle();
    if (run.error) throw new Error("Unable to read mission research run for briefing");
    const researchRunId = run.data?.research_run_id as string | null | undefined;
    const blockers = run.data?.last_error_category ? [String(run.data.last_error_category)] : [];
    if (!researchRunId) {
      if (!run.data) blockers.push("Δεν εκτελέστηκε έρευνα σήμερα.");
      return { businessesChecked: 0, qualifiedLeads: 0, noOfficialSiteFound: 0, weakSite: 0, publicEmail: 0, publicPhone: 0, rejectedCandidates: 0, blockers, bestLeads: [] };
    }
    const [researchRun, candidateQuery, sourceQuery] = await Promise.all([
      this.db.from("research_runs").select("status").eq("id", researchRunId).eq("user_id", this.userId).maybeSingle(),
      this.db.from("research_candidates").select("id,status,lead_id,error_message").eq("user_id", this.userId).eq("research_run_id", researchRunId),
      this.db.from("research_sources").select("candidate_id,source_url,metadata_json").eq("user_id", this.userId).eq("research_run_id", researchRunId),
    ]);
    if (researchRun.error || candidateQuery.error || sourceQuery.error) throw new Error("Unable to read persisted research briefing evidence");
    if (researchRun.data?.status === "failed") blockers.push("Η έρευνα απέτυχε.");
    const candidates = candidateQuery.data ?? [];
    const sources = sourceQuery.data ?? [];
    const candidateIds = candidates.map((item) => String(item.id));
    const leadIds = [...new Set(candidates.filter((item) => item.status === "qualified" && item.lead_id).map((item) => String(item.lead_id)))];
    const [analysisQuery, leadQuery] = await Promise.all([
      candidateIds.length ? this.db.from("website_analyses").select("candidate_id,status,analysis_json").eq("user_id", this.userId).in("candidate_id", candidateIds) : Promise.resolve({ data: [], error: null }),
      leadIds.length ? this.db.from("leads").select("id,business_name,score,score_reason,email,phone").eq("user_id", this.userId).in("id", leadIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (analysisQuery.error || leadQuery.error) throw new Error("Unable to read website and lead briefing evidence");
    const analyses = analysisQuery.data ?? [];
    const leads = leadQuery.data ?? [];
    const websiteStatus = new Map<string, string>();
    for (const source of sources) {
      const status = source.metadata_json?.websiteStatus;
      if (source.candidate_id && typeof status === "string") websiteStatus.set(String(source.candidate_id), status);
    }
    const weakCandidateIds = new Set(analyses.filter((item) => item.status === "completed" && Array.isArray(item.analysis_json?.digitalGaps) && item.analysis_json.digitalGaps.length > 0).map((item) => String(item.candidate_id)));
    const candidateByLead = new Map(candidates.filter((item) => item.lead_id).map((item) => [String(item.lead_id), String(item.id)]));
    const bestLeads = leads.map((lead) => ({
      name: String(lead.business_name), score: Number(lead.score ?? 0), reason: String(lead.score_reason ?? "Δεν υπάρχει καταγεγραμμένη αιτιολόγηση."),
      evidenceUrls: [...new Set(sources.filter((source) => String(source.candidate_id) === candidateByLead.get(String(lead.id))).map((source) => String(source.source_url)))].slice(0, 3),
    })).sort((a, b) => b.score - a.score).slice(0, 5);
    const failedCandidates = candidates.filter((item) => item.status === "failed");
    if (failedCandidates.length) blockers.push(`${failedCandidates.length} υποψήφιοι απέτυχαν κατά την επαλήθευση.`);
    return {
      businessesChecked: candidates.filter((item) => item.status !== "discovered").length,
      qualifiedLeads: candidates.filter((item) => item.status === "qualified").length,
      noOfficialSiteFound: candidates.filter((item) => websiteStatus.get(String(item.id)) === "NO_OFFICIAL_SITE_FOUND").length,
      weakSite: candidates.filter((item) => websiteStatus.get(String(item.id)) === "VERIFIED_WEBSITE" && weakCandidateIds.has(String(item.id))).length,
      publicEmail: leads.filter((lead) => Boolean(lead.email)).length,
      publicPhone: leads.filter((lead) => Boolean(lead.phone)).length,
      rejectedCandidates: candidates.filter((item) => item.status === "analyzed" || item.status === "failed").length,
      blockers,
      bestLeads,
    };
  }

  async generateBriefing(missionId: string, now = new Date()) {
    const mission = await this.get(missionId);
    if (!mission || mission.status !== "active") return { skipped: "mission_not_active" };
    const local = missionLocalClock(now, mission.timezone);
    const metrics = await this.metrics(mission.id, local.date);
    const research = isResearchOnlyMission(mission) ? await this.researchOnlyBriefing(mission, local.date) : null;
    const summary = research ? formatResearchOnlyBriefing(research) : deterministicMissionBriefing(metrics);
    const { data, error } = await this.db.from("mission_daily_briefings").upsert({ user_id: this.userId, mission_id: mission.id, local_date: local.date, metrics_json: research ? { ...metrics, research } : metrics, summary }, { onConflict: "mission_id,local_date" }).select("id").single();
    if (error) throw new Error("Unable to persist mission briefing");
    await this.recordEvent(mission.id, `briefing:${local.date}`, "MISSION_DAILY_BRIEFING_READY", "LOW", { briefingId: data.id });
    return { briefingId: data.id, metrics };
  }
}

export function missionOutreachKey(missionId: string, targetId: string, recipient: string, subject: string, body: string) {
  return createHash("sha256").update(JSON.stringify({ missionId, targetId, recipient: recipient.toLowerCase(), subject, body })).digest("hex");
}
