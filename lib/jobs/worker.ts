import { scheduler as nodeScheduler } from "node:timers/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobQueue } from "./contracts";
import { classifyJobError, retryAt } from "./retry-policy";
import { executeBackgroundJob } from "./executor";
import { operationLog } from "@/lib/operations/events";

export async function runWorkerOnce(queue: JobQueue, db: SupabaseClient, workerId: string) {
  const job = await queue.claim(workerId); if (!job) return null;
  const started = Date.now(); const lease = keepLease(queue, job.id, workerId);
  operationLog("job_started", { jobId: job.id, correlationId: job.correlationId, userId: job.userId, jobType: job.jobType, attempt: job.attemptCount, workerId });
  try {
    const result = await executeBackgroundJob(db, job); await lease.stop(); await queue.complete(job.id, workerId, summarizeResult(result));
    operationLog("job_completed", { jobId: job.id, correlationId: job.correlationId, userId: job.userId, jobType: job.jobType, attempt: job.attemptCount, durationMs: Date.now() - started, outcome: "completed" });
    return { job, outcome: "completed" as const };
  } catch (error) {
    await lease.stop(); const decision = classifyJobError(error); const canRetry = decision.retryable && job.attemptCount < job.maxAttempts;
    const repositories = job.userId ? (await import("@/lib/repositories/supabase")).createSupabaseRepositories(db, job.userId) : null;
    if (repositories && /^(gmail|calendar|provider_)/.test(job.jobType)) { const capability = job.jobType.startsWith("calendar") ? "calendar" as const : "gmail" as const; const connection = await repositories.connections.getGoogle(); if (connection) { const health = (await repositories.connections.listHealth()).find((item) => item.capability === capability); await repositories.connections.upsertHealth({ connectionId: connection.id, capability, status: decision.category === "credentials" ? "needs_reconnect" : canRetry ? "degraded" : "error", lastSuccessfulApiCallAt: health?.lastSuccessfulApiCallAt ?? null, lastSyncAt: health?.lastSyncAt ?? null, lastWebhookAt: health?.lastWebhookAt ?? null, watchExpiration: health?.watchExpiration ?? null, consecutiveFailures: (health?.consecutiveFailures ?? 0) + 1, lastErrorCategory: decision.category, lastErrorSummary: decision.safeSummary }); } }
    if (canRetry) await queue.retry(job.id, workerId, decision.safeSummary, retryAt(job.attemptCount));
    else { await queue.fail(job.id, workerId, decision.safeSummary, true); if (repositories) await repositories.notifications.create({ type: "PROVIDER_ERROR", priority: decision.category === "credentials" ? "urgent" : "important", title: "Background operation needs attention", body: decision.safeSummary, entityType: "background_job", entityId: job.id, metadata: { dedupeKey: `job-dead-letter:${job.id}`, correlationId: job.correlationId, jobType: job.jobType } }); }
    operationLog("job_failed", { jobId: job.id, correlationId: job.correlationId, userId: job.userId, jobType: job.jobType, attempt: job.attemptCount, durationMs: Date.now() - started, outcome: canRetry ? "retrying" : "dead_letter", errorCategory: decision.category });
    return { job, outcome: canRetry ? "retrying" as const : "dead_letter" as const };
  }
}

function keepLease(queue: JobQueue, jobId: string, workerId: string) { const controller = new AbortController(); const lockSeconds = Math.max(30, Number(process.env.JOB_LOCK_TIMEOUT_SECONDS ?? 300)); const pulse = (async () => { while (!controller.signal.aborted) { try { await waitWithoutTimer(Math.max(10_000, lockSeconds * 300), controller.signal); } catch { break; } if (!controller.signal.aborted) await queue.heartbeat(jobId, workerId).catch(() => false); } })(); return { async stop() { controller.abort(); await pulse; } }; }
function summarizeResult(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object") return {}; const allowed = ["processed", "notifications", "events", "expiration", "connected", "retentionDays", "notificationId"]; return Object.fromEntries(Object.entries(value).filter(([key, item]) => allowed.includes(key) && ["string", "number", "boolean"].includes(typeof item))); }
export async function waitWithoutTimer(milliseconds: number, signal?: AbortSignal) { await nodeScheduler.wait(milliseconds, { signal }); }
