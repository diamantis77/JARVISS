import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobQueue } from "./contracts";
import { missionLocalClock, missionWithinHours } from "../missions/service";

export function dueMissionJobs(row: { id: string; user_id: string; status: string; timezone: string; work_start: string; work_end: string; briefing_time: string }, now: Date) {
  if (row.status !== "active") return [];
  const local = missionLocalClock(now, row.timezone || "Europe/Athens");
  const jobs: Array<{ jobType: "mission_tick" | "mission_brief"; deduplicationKey: string; payload: { missionId: string; localDate: string }; priority: number }> = [];
  if (row.status === "active" && missionWithinHours({ workStart: row.work_start, workEnd: row.work_end }, local.time)) {
    const halfHourWindow = Math.floor((Number(local.time.slice(0, 2)) * 60 + Number(local.time.slice(3, 5))) / 30);
    jobs.push({ jobType: "mission_tick", priority: 35, deduplicationKey: `mission-tick:${row.id}:${local.date}:${halfHourWindow}`, payload: { missionId: row.id, localDate: local.date } });
  }
  if (local.time >= row.briefing_time.slice(0, 5)) jobs.push({ jobType: "mission_brief", priority: 25, deduplicationKey: `mission-brief:${row.id}:${local.date}`, payload: { missionId: row.id, localDate: local.date } });
  return jobs;
}

export function gmailPollKey(connectionId: string, scopes: string[], watchExpiration: string | null, pubsubTopic: string | undefined, now: Date) {
  if (!scopes.includes("https://www.googleapis.com/auth/gmail.readonly")) return null;
  if (pubsubTopic && watchExpiration && new Date(watchExpiration).getTime() > now.getTime()) return null;
  return `gmail-poll:${connectionId}:${Math.floor(now.getTime() / (5 * 60_000))}`;
}

export class ProductionScheduler {
  constructor(private readonly db: SupabaseClient, private readonly queue: JobQueue, private readonly schedulerId: string) {}
  async runOnce(now = new Date()) { await this.heartbeat(); let enqueued = 0; const dateKey = now.toISOString().slice(0, 10); const healthWindow = Math.floor(now.getTime() / (5 * 60_000)); const reconcileWindow = Math.floor(now.getTime() / (60 * 60_000)); const { data: connections, error } = await this.db.from("provider_connections").select("id,user_id,status,scopes,provider_sync_state(capability,watch_expiration)").eq("provider", "google").eq("status", "connected"); if (error) throw new Error("Scheduler cannot read provider connections"); for (const connection of connections ?? []) { const userId = String(connection.user_id); const scopes = Array.isArray(connection.scopes) ? connection.scopes as string[] : []; const states = Array.isArray(connection.provider_sync_state) ? connection.provider_sync_state as Array<{ capability: "gmail" | "calendar"; watch_expiration: string | null }> : []; for (const capability of ["gmail", "calendar"] as const) { if (capability === "gmail" && (!process.env.GOOGLE_PUBSUB_TOPIC || !scopes.includes("https://www.googleapis.com/auth/gmail.readonly"))) continue; if (capability === "calendar" && (!process.env.GOOGLE_CALENDAR_WEBHOOK_BASE_URL || !scopes.includes("https://www.googleapis.com/auth/calendar.events"))) continue; const state = states.find((item) => item.capability === capability); if (!state?.watch_expiration || new Date(state.watch_expiration).getTime() <= now.getTime() + 48 * 60 * 60_000) { await this.queue.enqueue({ userId, jobType: `${capability}_watch_renewal`, priority: 85, deduplicationKey: `watch-renewal:${connection.id}:${capability}:${dateKey}`, payload: { connectionId: connection.id } }); enqueued += 1; } } await this.queue.enqueue({ userId, jobType: "provider_health_check", priority: 30, deduplicationKey: `provider-health:${connection.id}:${healthWindow}`, payload: { connectionId: connection.id } }); await this.queue.enqueue({ userId, jobType: "provider_reconciliation", priority: 20, deduplicationKey: `provider-reconciliation:${connection.id}:${reconcileWindow}`, payload: { connectionId: connection.id } }); enqueued += 2; }
    // Without an active Gmail push watch, hourly reconciliation can miss the
    // 30-minute freshness window required for a verified customer-reply call.
    for (const connection of connections ?? []) {
      const scopes = Array.isArray(connection.scopes) ? connection.scopes as string[] : [];
      const states = Array.isArray(connection.provider_sync_state) ? connection.provider_sync_state as Array<{ capability: "gmail" | "calendar"; watch_expiration: string | null }> : [];
      const key = gmailPollKey(String(connection.id), scopes, states.find((item) => item.capability === "gmail")?.watch_expiration ?? null, process.env.GOOGLE_PUBSUB_TOPIC, now);
      if (!key) continue;
      await this.queue.enqueue({ userId: String(connection.user_id), jobType: "gmail_sync", priority: 55, deduplicationKey: key, payload: { connectionId: connection.id } });
      enqueued += 1;
    }
    const { data: settings, error: settingsError } = await this.db.from("settings").select("user_id,timezone,daily_brief_time").eq("daily_brief_enabled", true); if (settingsError) throw new Error("Scheduler cannot read daily brief settings"); for (const row of settings ?? []) { const local = localClock(now, String(row.timezone ?? "UTC")); const target = String(row.daily_brief_time ?? "08:30").slice(0, 5); if (local.time >= target) { await this.queue.enqueue({ userId: String(row.user_id), jobType: "daily_brief", priority: 40, deduplicationKey: `daily-brief:${row.user_id}:${local.date}`, payload: { localDate: local.date, timezone: row.timezone } }); enqueued += 1; } }
    const missionQuery = await this.db.from("missions").select("id,user_id,status,timezone,work_start,work_end,briefing_time").neq("status", "stopped");
    if (missionQuery.error && !["42P01", "PGRST205"].includes(missionQuery.error.code ?? "")) throw new Error("Scheduler cannot read missions");
    for (const row of missionQuery.data ?? []) for (const job of dueMissionJobs({ id: String(row.id), user_id: String(row.user_id), status: String(row.status), timezone: String(row.timezone), work_start: String(row.work_start), work_end: String(row.work_end), briefing_time: String(row.briefing_time) }, now)) {
      await this.queue.enqueue({ userId: String(row.user_id), ...job });
      enqueued += 1;
    }
    await this.queue.enqueue({ userId: null, jobType: "notification_cleanup", priority: 5, deduplicationKey: `operations-cleanup:${dateKey}`, scheduledFor: now.toISOString() }); enqueued += 1; return { enqueued }; }
  async heartbeat() { const { error } = await this.db.from("operation_runtime").upsert({ runtime_id: this.schedulerId, runtime_type: "scheduler", version: "0.6.0", last_seen_at: new Date().toISOString(), metadata: {} }); if (error) throw new Error("Scheduler heartbeat failed"); }
}

function localClock(date: Date, timezone: string) { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date); const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"; return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` }; }
