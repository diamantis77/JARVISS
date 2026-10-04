"use client";

import { useEffect, useState } from "react";
import type { ResearchRun } from "@/types";
import { formatDateTime } from "@/lib/i18n";

export function ResearchOperations({ initial }: { initial: ResearchRun[] }) {
  const [runs, setRuns] = useState(initial);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/research/runs", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { runs: ResearchRun[] };
        if (active) setRuns(data.runs);
      } catch { /* Keep last persisted snapshot visible until connectivity returns. */ }
    };
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return <section className="panel operations-section research-section" id="research" aria-label="Research operations">
    <div className="operations-section-head"><div><p className="panel-title">LIVE RESEARCH</p><h2>Έρευνες</h2><p>Πραγματική πρόοδος και τεκμηριωμένα αποτελέσματα.</p></div><span className="operations-count">{runs.length} ΠΡΟΣΦΑΤΕΣ</span></div>
    {runs.length ? <div className="research-list">{runs.map((run) => {
      const progress = run.discoveredCount > 0 ? Math.min(100, Math.round(run.processedCount / run.discoveredCount * 100)) : 0;
      return <article className="research-card" key={run.id}><div className="research-card-main"><div className="research-card-heading"><h3>{run.query}</h3><span className={`operations-status ${run.status}`}>{run.status.replaceAll("_", " ")}</span>{(run.config.criteria as Record<string, unknown> | undefined)?.testOnly === true && <span className="operations-tag">TEST</span>}</div><p>Ξεκίνησε {formatDateTime(run.createdAt)}</p><div className="research-progress" role="progressbar" aria-label={`Πρόοδος έρευνας ${run.query}`} aria-valuenow={run.processedCount} aria-valuemin={0} aria-valuemax={Math.max(run.discoveredCount, run.processedCount, 1)}><span style={{ width: `${progress}%` }} /></div></div><div className="research-card-stats"><div><b>{run.processedCount}<small> / {run.discoveredCount}</small></b><span>Ελέγχθηκαν</span></div><div><b>{run.qualifiedCount}<small> / {run.requestedLimit}</small></b><span>Qualified</span></div></div></article>;
    })}</div> : <p className="operations-state">Δεν υπάρχουν έρευνες ακόμη.</p>}
  </section>;
}
