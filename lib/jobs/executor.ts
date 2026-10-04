import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackgroundJob } from "@/types";
import { createSupabaseRepositories } from "@/lib/repositories/supabase";
import { syncCalendar, syncGmail, renewCalendarWatch, renewGmailWatch } from "@/lib/google/sync";
import { createResearchService } from "@/lib/research/factory";
import { emitInternalEvent } from "@/lib/operations/events";
import { SupabaseJobQueue } from "./supabase-queue";
import { SupabasePhoneCallRepository } from "@/lib/telephony/repository";
import { createTelephonyProvider } from "@/lib/telephony/provider";
import { logPhoneDiagnostic } from "@/lib/telephony/diagnostics";
import { MissionService, missionLocalClock, missionWithinHours } from "../missions/service";

export async function executeBackgroundJob(db: SupabaseClient, job: BackgroundJob) {
  if (!job.userId && !["notification_cleanup"].includes(job.jobType)) throw new Error("Invalid payload: user-owned job has no owner");
  const repositories = job.userId ? createSupabaseRepositories(db, job.userId) : null;
  switch (job.jobType) {
    case "gmail_sync": return syncGmail(repositories!, { correlationId: job.correlationId, queueDb: db });
    case "gmail_watch_renewal": return renewGmailWatch(repositories!);
    case "calendar_sync": return syncCalendar(repositories!, (await repositories!.settings.get()).timezone, { correlationId: job.correlationId, queueDb: db });
    case "calendar_watch_renewal": return renewCalendarWatch(repositories!);
    case "provider_reconciliation": { const settings = await repositories!.settings.get(); const [gmail, calendar] = await Promise.allSettled([syncGmail(repositories!, { correlationId: job.correlationId, queueDb: db }), syncCalendar(repositories!, settings.timezone, { correlationId: job.correlationId, queueDb: db })]); return { gmail: gmail.status, calendar: calendar.status }; }
    case "provider_health_check": return checkProviderHealth(repositories!);
    case "research_continue": {
      const researchRunId = String(job.payload.researchRunId ?? "");
      if (!researchRunId) throw new Error("Invalid payload: researchRunId is required");
      let missionRunId = typeof job.payload.missionRunId === "string" ? job.payload.missionRunId : null;
      if (!missionRunId) {
        const linked = await db.from("mission_runs").select("id").eq("user_id", job.userId!).eq("research_run_id", researchRunId).maybeSingle();
        if (linked.error) throw new Error("Unable to inspect mission research ownership");
        missionRunId = linked.data?.id ?? null;
      }
      let mission: Awaited<ReturnType<MissionService["get"]>> = null;
      if (missionRunId) {
        const missionRun = await db.from("mission_runs").select("mission_id").eq("id", missionRunId).eq("user_id", job.userId!).eq("research_run_id", researchRunId).maybeSingle();
        if (missionRun.error || !missionRun.data) throw new Error("Unable to link mission research continuation");
        mission = await new MissionService(db, job.userId!).get(missionRun.data.mission_id);
        if (!mission || mission.status !== "active") { await repositories!.research.updateRun(researchRunId, { status: "partial" }); return { skipped: "mission_not_active" }; }
        const local = missionLocalClock(new Date(), mission.timezone);
        if (!missionWithinHours(mission, local.time)) { await repositories!.research.updateRun(researchRunId, { status: "partial" }); return { skipped: "outside_working_hours" }; }
      }
      const result = await createResearchService(repositories!, "live", job.userId!).continue({ researchRunId });
      if (result.status === "partial") {
        const current = await repositories!.research.getRun(researchRunId);
        const queriesUsed = Number(current?.config.totalQueriesUsed ?? 0);
        await new SupabaseJobQueue(db).enqueue({ userId: job.userId!, jobType: "research_continue", priority: job.priority, scheduledFor: new Date(Date.now() + 10_000).toISOString(), deduplicationKey: `research-continuation:${researchRunId}:${result.processedCount}:${result.discoveredCount}:${queriesUsed}`, correlationId: job.correlationId, payload: { researchRunId, ...(missionRunId ? { missionRunId } : {}) } });
      }
      if (missionRunId && mission) {
        const service = new MissionService(db, job.userId!);
        await service.syncTargets(mission, missionRunId, researchRunId);
        if (result.status === "failed" || result.status === "cancelled") {
          const recorded = await db.from("mission_runs").update({ status: "failed", last_error_category: result.status === "cancelled" ? "research_cancelled" : "research_failed" }).eq("id", missionRunId).eq("user_id", job.userId!);
          if (recorded.error) throw new Error("Unable to persist mission research failure");
          await service.recordEvent(mission.id, `research-stop:${missionRunId}`, "MISSION_BLOCKED", "HIGH", { category: result.status === "cancelled" ? "research_cancelled" : "research_failed" }, missionRunId);
        }
      }
      if (result.status === "completed") await emitInternalEvent(db, { userId: job.userId!, eventType: "RESEARCH_COMPLETED", payload: { researchRunId }, correlationId: job.correlationId, deduplicationKey: `research-completed:${researchRunId}` });
      return result;
    }
    case "notification_process": return processNotificationJob(repositories!, job);
    case "daily_brief": return generateDailyBrief(repositories!, db, job);
    case "outbound_jarvis_call": return placeOutboundJarvisCall(db, job);
    case "mission_tick": { const missionId = String(job.payload.missionId ?? ""); if (!missionId || !job.userId) throw new Error("Invalid mission tick payload"); return new MissionService(db, job.userId).tick(missionId); }
    case "mission_brief": { const missionId = String(job.payload.missionId ?? ""); if (!missionId || !job.userId) throw new Error("Invalid mission briefing payload"); return new MissionService(db, job.userId).generateBriefing(missionId); }
    case "notification_cleanup": return cleanupOperations(db);
    default: throw new Error(`Invalid payload: unsupported job type ${job.jobType}`);
  }
}

async function placeOutboundJarvisCall(db: SupabaseClient, job: BackgroundJob) {
  const phoneCallId = String(job.payload.phoneCallId ?? "");
  if (!phoneCallId || !job.userId) throw new Error("Invalid payload: phoneCallId is required");
  const repository = new SupabasePhoneCallRepository(db);
  const call = await repository.get(phoneCallId);
  if (!call || call.userId !== job.userId) throw new Error("Invalid payload: phone call does not belong to this job owner");
  if (call.providerCallId || !["queued", "failed"].includes(call.status)) return { phoneCallId: call.id, status: call.status, duplicatePrevented: true };
  await repository.update(call.id, { status: "dialing", startedAt: call.startedAt ?? new Date().toISOString(), errorCategory: "", errorSummary: "" });
  let result: Awaited<ReturnType<ReturnType<typeof createTelephonyProvider>["createOwnerCall"]>>;
  try {
    result = await createTelephonyProvider(call.provider).createOwnerCall({ phoneCallId: call.id, reason: call.reason });
  } catch (error) {
    await repository.update(call.id, { status: "failed", endedAt: new Date().toISOString(), errorCategory: "provider", errorSummary: "The provider did not accept the outbound call." }).catch(() => undefined);
    throw error;
  }
  // Answer/Event callbacks can arrive before the create-call HTTP response.
  // Never roll an answered or terminal call back to dialing.
  const dialing = await db.from("phone_calls")
    .update({ provider_call_id: result.providerCallId, provider_status: result.providerStatus })
    .eq("id", call.id).eq("status", "dialing").is("provider_call_id", null)
    .select("id").maybeSingle();
  if (dialing.error) throw new Error("Unable to persist accepted provider call");
  if (!dialing.data) {
    const current = await repository.get(call.id);
    if (!current) throw new Error("Accepted provider call record is missing");
    if (current.providerCallId && current.providerCallId !== result.providerCallId) throw new Error("Accepted provider call ID does not match callback");
    if (!current.providerCallId) {
      const linked = await db.from("phone_calls").update({ provider_call_id: result.providerCallId })
        .eq("id", call.id).is("provider_call_id", null).select("id").maybeSingle();
      if (linked.error) throw new Error("Unable to link accepted provider call");
    }
    logPhoneDiagnostic("provider_callback_preceded_create_response", { phoneCallId: call.id, status: current.status });
  }
  return { phoneCallId: call.id, providerStatus: result.providerStatus };
}

async function checkProviderHealth(repositories: NonNullable<ReturnType<typeof createSupabaseRepositories>>) {
  const connection = await repositories.connections.getGoogle();
  if (!connection) return { connected: false };
  const states = await Promise.all((["gmail", "calendar"] as const).map(async (capability) => {
    const sync = await repositories.connections.getSyncState(connection.id, capability);
    const watchConfigured = capability === "gmail" ? Boolean(process.env.GOOGLE_PUBSUB_TOPIC) : Boolean(process.env.GOOGLE_CALENDAR_WEBHOOK_BASE_URL);
    const watchRisk = watchConfigured && (!sync?.watchExpiration || new Date(sync.watchExpiration).getTime() < Date.now() + 48 * 60 * 60_000);
    return repositories.connections.upsertHealth({ connectionId: connection.id, capability, status: connection.status === "needs_reconnect" ? "needs_reconnect" : watchRisk ? "watch_expiring" : "healthy", lastSuccessfulApiCallAt: sync?.lastSuccessfulSyncAt ?? null, lastSyncAt: sync?.lastSuccessfulSyncAt ?? null, lastWebhookAt: null, watchExpiration: sync?.watchExpiration ?? null, consecutiveFailures: connection.errorCode ? 1 : 0, lastErrorCategory: connection.errorCode, lastErrorSummary: connection.errorMessage });
  }));
  return { connected: true, states: states.map((item) => item.status) };
}

async function processNotificationJob(repositories: NonNullable<ReturnType<typeof createSupabaseRepositories>>, job: BackgroundJob) { const kind = String(job.payload.kind ?? ""); if (kind !== "meeting_reminder") throw new Error("Invalid payload: notification kind is unsupported"); const eventId = String(job.payload.eventId ?? ""); const title = String(job.payload.title ?? "Meeting").slice(0, 200); const start = String(job.payload.start ?? ""); return repositories.notifications.create({ type: "UPCOMING_MEETING", priority: "important", title: `${title} starts in 15 minutes`, body: start, entityType: "calendar_event", entityId: eventId || null, metadata: { dedupeKey: `meeting-reminder:${eventId}:${start}`, correlationId: job.correlationId } }); }

async function generateDailyBrief(repositories: NonNullable<ReturnType<typeof createSupabaseRepositories>>, db: SupabaseClient, job: BackgroundJob) { const [leads, tasks, approvals, notifications] = await Promise.all([repositories.leads.list(), repositories.tasks.list("open"), repositories.approvals.getPending(), repositories.notifications.list(100, true)]); const important = notifications.filter((item) => ["important", "urgent"].includes(item.priority)).length; const meetings = notifications.filter((item) => item.type === "UPCOMING_MEETING").length; const qualified = leads.filter((lead) => lead.score >= 70).length; const localDate = typeof job.payload.localDate === "string" ? job.payload.localDate : new Date().toISOString().slice(0, 10); const body = `Today: ${important} important notifications, ${meetings} upcoming meetings, ${tasks.length} open tasks, ${qualified} high-priority leads, ${approvals.length} approvals awaiting review.`; const notification = await repositories.notifications.create({ type: "DAILY_BRIEF", priority: "info", title: "Good morning. Your JARVIS brief is ready.", body, entityType: "daily_brief", entityId: localDate, metadata: { dedupeKey: `daily-brief:${job.userId}:${localDate}`, correlationId: job.correlationId } }); await emitInternalEvent(db, { userId: job.userId!, eventType: "DAILY_BRIEF_READY", payload: { notificationId: notification.id }, correlationId: job.correlationId, deduplicationKey: `daily-brief-event:${notification.id}` }); return { notificationId: notification.id }; }

async function cleanupOperations(db: SupabaseClient) { const retentionDays = Math.max(1, Number(process.env.OPERATIONS_RETENTION_DAYS ?? 30)); const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString(); const [jobs, logs] = await Promise.all([db.from("background_jobs").delete().eq("status", "completed").lt("completed_at", cutoff), db.from("operation_logs").delete().lt("created_at", cutoff)]); if (jobs.error || logs.error) throw new Error("Temporary database cleanup failure"); return { retentionDays }; }
