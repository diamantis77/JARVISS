"use client";
import { Check, Circle, ChevronDown } from "lucide-react";
import type { JarvisRun } from "@/types";
import { localizeStatus, tr } from "@/lib/i18n";

export function RunProgress({ run, expanded, onToggle }: { run: JarvisRun; expanded: boolean; onToggle: () => void }) {
  const routing = run.context?.aiRouting as { provider?: string; model?: string; latencyMs?: number; fallbackUsed?: boolean; attempts?: Array<{ provider: string; model: string; success: boolean; reason?: string; latencyMs: number }> } | undefined;
  return <section className="run panel" aria-label={tr("Jarvis run progress")}>
    <div className="run-head"><div><div className="panel-title">{tr("Active run")}</div><h2>{run.request}</h2></div><span className="pill">{localizeStatus(run.status)}</span></div>
    <div className="steps">{run.steps.map((step) => <div className="step" key={step.id}>
      {step.status === "completed" ? <Check className="check" aria-label={tr("Completed")} /> : <Circle size={13} color="#8391a2" />}
      <div><strong>{step.title}</strong><p>{step.description}</p>{expanded && step.result && <p>{step.result}</p>}</div><span className="tool">{step.toolName}</span>
    </div>)}</div>
    {expanded && routing?.provider && <div className="ai-run-details"><strong>AI Request</strong><p>{routing.provider} · {routing.model} · {routing.latencyMs ?? 0} ms · fallback {routing.fallbackUsed ? "yes" : "no"}</p><ol>{routing.attempts?.map((attempt, index) => <li key={`${attempt.provider}-${index}`}>{attempt.provider} / {attempt.model}: {attempt.success ? "SUCCESS" : attempt.reason ?? "FAILED"} · {attempt.latencyMs} ms</li>)}</ol></div>}
    <button className="details" onClick={onToggle}>{tr(expanded ? "View less" : "View details")} <ChevronDown size={12} /></button>
  </section>;
}
