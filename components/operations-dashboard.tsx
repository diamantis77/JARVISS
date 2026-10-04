"use client";

import { useState } from "react";
import type { OperationsSnapshot } from "@/types";
import { formatDateTime, localizeStatus, tr } from "@/lib/i18n";

const groups = [
  ["Running", ["running"]],
  ["Scheduled", ["pending", "scheduled", "retrying"]],
  ["Failed", ["failed"]],
  ["Dead Letter", ["dead_letter"]],
  ["Recently Completed", ["completed"]],
] as const;

export function OperationsDashboard({ initial, mode }: { initial: OperationsSnapshot; mode: "demo" | "live" }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [message, setMessage] = useState("");

  async function act(id: string, action: "retry" | "cancel") {
    const response = await fetch("/api/operations/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error);
      return;
    }
    const refreshed = await fetch("/api/operations/jobs").then((item) => item.json());
    setSnapshot(refreshed);
    setMessage(action === "retry" ? "Η εργασία μπήκε ξανά στην ουρά." : "Η εργασία ακυρώθηκε.");
  }

  const hasActionRequired = snapshot.health.some((item) => ["error", "needs_reconnect"].includes(item.status))
    || snapshot.jobs.some((item) => item.status === "dead_letter");
  const hasDegradedState = snapshot.health.some((item) => item.status !== "healthy")
    || snapshot.jobs.some((item) => item.status === "retrying")
    || !snapshot.workerLastSeenAt
    || !snapshot.schedulerLastSeenAt;
  const overall = mode === "demo"
    ? "DEMO MODE"
    : hasActionRequired
      ? "ACTION REQUIRED"
      : hasDegradedState
        ? "DEGRADED"
        : snapshot.health.length
          ? "ALL SYSTEMS OPERATIONAL"
          : "CORE OPERATIONS ONLINE";

  return <>
    <section className="panel operations-summary" id="overview">
      <div className="operations-summary-title">
        <p className="panel-title">{mode === "live" ? "LIVE · SUPABASE" : tr("DEMO MODE · FICTIONAL DATA")}</p>
        <h2><i className={hasActionRequired ? "alert" : hasDegradedState ? "warning" : "ok"} />{tr(overall)}</h2>
        <p>{tr("Worker")}: {snapshot.workerLastSeenAt ? formatDateTime(snapshot.workerLastSeenAt) : tr("not detected")} <span>·</span> {tr("Scheduler")}: {snapshot.schedulerLastSeenAt ? formatDateTime(snapshot.schedulerLastSeenAt) : tr("not detected")}</p>
      </div>
      <div className="operations-metrics">
        <span>{snapshot.metrics.jobs_pending ?? 0}<small>{tr("Pending")}</small></span>
        <span>{snapshot.metrics.jobs_failed ?? 0}<small>{tr("Failed")}</small></span>
        <span>{snapshot.metrics.jobs_completed ?? 0}<small>{tr("Completed")}</small></span>
      </div>
    </section>
    <section className="operations-health">
      {snapshot.health.length ? snapshot.health.map((item) => <article className="panel" key={`${item.connectionId}-${item.capability}`}>
        <p className="panel-title">{item.capability}</p>
        <h3>{localizeStatus(item.status)}</h3>
        <p>{tr("Last sync")}: {item.lastSyncAt ? formatDateTime(item.lastSyncAt) : tr("never")}</p>
        <p>{tr("Watch expires")}: {item.watchExpiration ? formatDateTime(item.watchExpiration) : tr("unknown")}</p>
        {item.lastErrorSummary && <p className="auth-error">{item.lastErrorSummary}</p>}
      </article>) : <article className="panel">
        <p className="panel-title">{tr("Provider health")}</p>
        <p>{tr(mode === "live" ? "No provider health records yet. Supabase operations are live." : "No live provider health records. Demo Mode remains isolated.")}</p>
      </article>}
    </section>
    {message && <div className="auth-message" role="status">{message}</div>}
    <details className="panel operations-job-board" open={hasActionRequired}>
      <summary><span><small>BACKGROUND OPERATIONS</small><b>Ουρά εργασιών</b></span><em>{snapshot.jobs.length} πρόσφατες εργασίες</em></summary>
      <div className="operations-groups">{groups.map(([title, statuses]) => {
        const jobs = snapshot.jobs.filter((job) => (statuses as readonly string[]).includes(job.status)).slice(0, 20);
        if (!jobs.length) return null;
        return <section className="panel" key={title}>
          <p className="panel-title">{tr(title)}</p>
          {jobs.map((job) => <article className="job-row" key={job.id}>
            <div>
              <b>{job.jobType.replaceAll("_", " ")}</b>
              <span>{formatDateTime(job.createdAt)} · προσπάθεια {job.attemptCount}/{job.maxAttempts}</span>
              {job.lastError && <span>{job.lastError}</span>}
            </div>
            <div>
              {["failed", "dead_letter"].includes(job.status) && <button className="secondary" onClick={() => void act(job.id, "retry")}>{tr("Retry")}</button>}
              {["pending", "scheduled", "retrying", "failed"].includes(job.status) && <button className="secondary danger" onClick={() => void act(job.id, "cancel")}>{tr("Cancel")}</button>}
            </div>
          </article>)}
        </section>;
      })}{snapshot.jobs.length === 0 && <p className="operations-state">{tr("None")}.</p>}</div>
    </details>
  </>;
}
