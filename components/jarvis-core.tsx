"use client";
import type { JarvisState } from "@/types";

const copy: Record<JarvisState, [string, string]> = {
  idle: ["IDLE", "Systems ready · demo providers active"], listening: ["LISTENING", "Voice demo is ready"], thinking: ["THINKING", "Creating an execution plan"], executing: ["EXECUTING", "Using constrained tools"], success: ["COMPLETE", "Run finished and memory updated"], error: ["ATTENTION", "A safe recovery is required"],
};
export function JarvisCore({ state }: { state: JarvisState }) {
  const [label, sub] = copy[state];
  return <div className="core-zone panel" aria-label={`Jarvis state: ${label}`}>
    <div className={`core ${state}`}><span className="ring ring-one" /><span className="ring ring-two" /><span className="ring ring-three" /><span className="core-center" /></div>
    <div className="core-label"><div className="state">{label}</div><div className="state-sub">{sub}</div></div>
  </div>;
}
