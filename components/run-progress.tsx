"use client";
import { Check, Circle, ChevronDown } from "lucide-react";
import type { JarvisRun } from "@/types";

export function RunProgress({ run, expanded, onToggle }: { run: JarvisRun; expanded: boolean; onToggle: () => void }) {
  return <section className="run panel" aria-label="Jarvis run progress">
    <div className="run-head"><div><div className="panel-title">Active run</div><h2>{run.request}</h2></div><span className="pill">{run.status}</span></div>
    <div className="steps">{run.steps.map((step) => <div className="step" key={step.id}>
      {step.status === "completed" ? <Check className="check" aria-label="Completed" /> : <Circle size={13} color="#8391a2" />}
      <div><strong>{step.title}</strong><p>{step.description}</p>{expanded && step.result && <p>{step.result}</p>}</div><span className="tool">{step.toolName}</span>
    </div>)}</div>
    <button className="details" onClick={onToggle}>View {expanded ? "less" : "details"} <ChevronDown size={12} /></button>
  </section>;
}
