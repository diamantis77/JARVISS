"use client";
import { ArrowUpRight, LogOut, Mic, MicOff, Send, Settings, Sparkles, Square, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { JarvisCore } from "@/components/jarvis-core";
import { RunProgress } from "@/components/run-progress";
import { ActivityPanel } from "@/components/activity-panel";
import { ApprovalCard } from "@/components/approval-card";
import { signOut } from "@/app/auth/actions";
import { BrowserVoiceProvider } from "@/lib/voice/browser-provider";
import type { Activity, Approval, JarvisRun, JarvisState, Lead, Task } from "@/types";
import type { VoiceSnapshot } from "@/lib/voice/contracts";

const quickCommands = ["Find 10 dentists in Athens", "Find my strongest leads", "Analyze my top business", "Pending approvals"];
const initialVoice: VoiceSnapshot = { state: "idle", muted: false, inputLevel: 0, outputLevel: 0, error: null };
const activeVoiceStates = new Set(["requesting_microphone", "connecting", "listening", "user_speaking", "processing", "jarvis_speaking", "interrupted", "reconnecting"]);
interface CommandCenterProps { mode: "demo" | "live"; aiMode: "demo" | "openai"; researchMode: "demo" | "live" | "disabled"; voiceEnabled: boolean; leads: Lead[]; activities: Activity[]; tasks: Task[]; approvals: Approval[]; initialRun: JarvisRun; initialCommand?: string }
type StreamEvent = { type: "run" | "step" | "approval" | "complete" | "error"; run?: JarvisRun; approval?: Approval; message?: string; research?: { researchRunId: string; status: string } };
type VoiceTurn = { id: string; user: string; assistant: string };

export function CommandCenter({ mode, aiMode, researchMode, voiceEnabled, leads, activities, tasks, approvals, initialRun, initialCommand = "" }: CommandCenterProps) {
  const [input, setInput] = useState(initialCommand); const [state, setState] = useState<JarvisState>("idle");
  const [run, setRun] = useState(initialRun); const [showDetails, setShowDetails] = useState(false); const [approval, setApproval] = useState<Approval | null>(approvals[0] ?? null);
  const [response, setResponse] = useState(initialRun.summary); const [busy, setBusy] = useState(false); const [clock, setClock] = useState("");
  const [voice, setVoice] = useState<VoiceSnapshot>(initialVoice); const [partial, setPartial] = useState(""); const [voiceTurns, setVoiceTurns] = useState<VoiceTurn[]>([]);
  const cancelRequested = useRef(false); const busyRef = useRef(false); const providerRef = useRef<BrowserVoiceProvider | null>(null);
  const activeResearchId = useRef<string | null>(typeof initialRun.context?.researchRunId === "string" ? initialRun.context.researchRunId : null);
  const hotLeads = useMemo(() => [...leads].sort((a, b) => b.score - a.score).slice(0, 3), [leads]);
  const voiceActive = activeVoiceStates.has(voice.state);
  useEffect(() => { const update = () => setClock(new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date())); update(); const id = window.setInterval(update, 30_000); return () => window.clearInterval(id); }, []);
  useEffect(() => () => { void providerRef.current?.stopSession(); }, []);

  async function consumeStream(result: Response) {
    if (!result.ok || !result.body) { const error = await result.json().catch(() => ({ error: "JARVIS could not start this run." })); throw new Error(error.error); }
    const reader = result.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let latestRun: JarvisRun | null = null; let finalMessage = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue; const event = JSON.parse(line) as StreamEvent;
        if (event.run) { latestRun = event.run; setRun(event.run); const id = event.run.context?.researchRunId; if (typeof id === "string") activeResearchId.current = id; }
        if (event.research?.researchRunId) activeResearchId.current = event.research.researchRunId;
        if (event.type === "run") setState("thinking");
        if (event.type === "step") setState("executing");
        if (event.type === "approval") { setState("idle"); if (event.approval) setApproval(event.approval); finalMessage = event.message ?? "Action requires approval."; setResponse(finalMessage); }
        if (event.type === "complete") { setState("success"); finalMessage = event.message ?? event.run?.summary ?? "Run completed."; setResponse(finalMessage); }
        if (event.type === "error") { setState("error"); finalMessage = event.message ?? "JARVIS could not complete this run."; setResponse(finalMessage); }
      }
    }
    return { latestRun, finalMessage: finalMessage || latestRun?.summary || "JARVIS completed the command." };
  }

  async function continueResearch(latestRun: JarvisRun | null) {
    let current = latestRun; let batchCount = 0;
    try {
      while (!cancelRequested.current && activeResearchId.current && current?.context?.researchStatus === "partial" && batchCount < 20) {
        batchCount += 1; setState("executing"); setResponse(`Research progress is persisted. Resuming batch ${batchCount + 1}…`);
        const result = await consumeStream(await fetch(`/api/research/${encodeURIComponent(activeResearchId.current)}/continue`, { method: "POST" })); current = result.latestRun;
      }
      if (!cancelRequested.current && current?.context?.researchStatus === "partial") setResponse("Research progress is saved and can be resumed safely.");
    } catch (error) { setState("error"); setResponse(error instanceof Error ? error.message : "JARVIS could not continue this research run."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function execute(command: string, voiceMeta?: { sessionId: string; commandId: string }) {
    if (!command.trim()) return "I did not receive a command.";
    if (busyRef.current) return /[Α-ω]/u.test(command) ? "Ο JARVIS εκτελεί ήδη μια εντολή. Η φωνητική συνεδρία παραμένει ενεργή." : "JARVIS is already executing a command. The voice session remains active.";
    cancelRequested.current = false; activeResearchId.current = null; busyRef.current = true; setBusy(true); setState("thinking"); setResponse("JARVIS is validating the command and preparing an execution context.");
    if (!voiceMeta) setInput("");
    try {
      const body = voiceMeta ? { command, source: "voice", voiceSessionId: voiceMeta.sessionId, voiceCommandId: voiceMeta.commandId } : { command };
      const result = await consumeStream(await fetch("/api/jarvis/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      if (activeResearchId.current && result.latestRun?.context?.researchStatus === "partial") {
        if (voiceMeta) { void continueResearch(result.latestRun); return `${result.finalMessage} I will continue the remaining research in the background.`; }
        await continueResearch(result.latestRun); return result.finalMessage;
      }
      busyRef.current = false; setBusy(false); return result.finalMessage;
    } catch (error) {
      const message = error instanceof Error ? error.message : "JARVIS could not complete this run."; setState("error"); setResponse(message); busyRef.current = false; setBusy(false); throw new Error(message);
    }
  }

  async function toggleVoice() {
    if (!voiceEnabled) { setResponse("Realtime voice is unavailable in this environment. Text mode remains fully available."); setState("error"); return; }
    if (providerRef.current && voiceActive) { await providerRef.current.stopSession(); return; }
    const provider = new BrowserVoiceProvider({
      onState: (snapshot) => { setVoice({ ...snapshot }); if (snapshot.error) setResponse(snapshot.error); },
      onPartialTranscript: setPartial,
      onCommand: (transcript, commandId, sessionId) => execute(transcript, { sessionId, commandId }),
      onFinalTurn: (user, assistant) => { setVoiceTurns((turns) => [...turns.slice(-3), { id: crypto.randomUUID(), user, assistant }]); setPartial(""); },
    });
    providerRef.current = provider; await provider.startSession();
  }
  function toggleMute() { const provider = providerRef.current; if (!provider) return; if (voice.muted) provider.unmute(); else provider.mute(); }

  async function cancelResearch() {
    const id = activeResearchId.current; if (!id) return; cancelRequested.current = true; setResponse("Cancelling after the current safe persistence point…");
    try { const result = await fetch(`/api/research/${encodeURIComponent(id)}/cancel`, { method: "POST" }); const data = await result.json(); if (!result.ok) throw new Error(data.error); if (data.run) setRun(data.run); setState("idle"); setResponse(data.message); }
    catch (error) { setState("error"); setResponse(error instanceof Error ? error.message : "Research could not be cancelled."); }
  }
  async function decideApproval(decision: "approved" | "rejected") { if (!approval) return; try { const result = await fetch(`/api/approvals/${approval.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) }); const data = await result.json(); if (!result.ok) throw new Error(data.error); setApproval(null); if (data.run) setRun(data.run); setResponse(data.message); setState(decision === "approved" ? "success" : "idle"); } catch (error) { setState("error"); setResponse(error instanceof Error ? error.message : "Approval could not be resolved."); } }
  async function editApproval(patch: { subject: string; preview: string }) { if (!approval) return; const result = await fetch(`/api/approvals/${approval.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }); const data = await result.json(); if (!result.ok) throw new Error(data.error); setApproval(data.approval); setResponse(data.message); }

  const qualified = leads.filter((lead) => lead.score >= 75).length;
  return <main className="shell"><header className="topbar"><Link href="/" className="wordmark"><span className="mark"><Sparkles size={16} /></span>JARVIS</Link><div className="sys"><span className="online"><i className="dot" />SYSTEMS NOMINAL</span><span>{mode === "demo" ? "DEMO MODE · FICTIONAL RESEARCH" : aiMode === "openai" ? researchMode === "live" ? "LIVE MODE · LIVE RESEARCH" : "LIVE MODE · RESEARCH OFF" : "LIVE DATA · DEMO AI"}</span><span className="clock">{clock}</span><Link href="/settings" className="icon-link" aria-label="Settings"><Settings size={13} /></Link>{mode === "live" && <form action={signOut}><button className="icon-link" aria-label="Sign out"><LogOut size={13} /></button></form>}</div></header>
    <div className="layout"><aside className="left-col"><section className="panel side"><p className="panel-title">Today</p><div className="metric"><span>CRM leads</span><b>{leads.length}</b></div><div className="metric"><span>Qualified</span><b className="accent">{qualified}</b></div><div className="metric"><span>Open tasks</span><b>{tasks.filter((task) => task.status === "open").length}</b></div><div className="metric"><span>Approvals</span><b className="warm">{approvals.length}</b></div></section><ActivityPanel activities={activities} /></aside>
      <section className="main"><JarvisCore state={state} voiceState={voice.state} audioLevel={Math.max(voice.inputLevel, voice.outputLevel)} /><RunProgress run={run} expanded={showDetails} onToggle={() => setShowDetails(!showDetails)} /><section className="response panel"><b>JARVIS · REPORT</b><p>{response}</p><div className="response-actions"><button className="primary" disabled={busy} onClick={() => void execute("Prepare outreach for my strongest lead")}>Prepare outreach</button><Link href="/leads" className="secondary">View leads</Link>{busy && activeResearchId.current && <button className="secondary danger" onClick={() => void cancelResearch()}><Square size={11} /> Cancel research</button>}</div></section>
        {(voiceActive || voiceTurns.length > 0 || partial) && <section className="voice-transcript panel" aria-live="polite"><div className="voice-head"><span><i className="voice-dot" />{voice.state.replaceAll("_", " ")}</span>{voiceActive && <button type="button" onClick={toggleMute} aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}>{voice.muted ? <MicOff size={13} /> : <Volume2 size={13} />}{voice.muted ? "Unmute" : "Mute"}</button>}</div>{voiceTurns.map((turn) => <div className="voice-turn" key={turn.id}><p><b>YOU</b>{turn.user}</p><p><b>JARVIS</b>{turn.assistant}</p></div>)}{partial && <p className="voice-partial"><b>YOU · LISTENING</b>{partial}</p>}</section>}
        <form className="command panel" onSubmit={(event) => { event.preventDefault(); void execute(input); }}><button className={`round voice-button ${voiceActive ? "active" : ""}`} type="button" aria-label={voiceActive ? "Stop voice session" : "Start realtime voice"} aria-pressed={voiceActive} onClick={() => void toggleVoice()}>{voiceActive ? <Square size={13} /> : <Mic size={15} />}</button><input value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} placeholder={busy ? "JARVIS is working…" : "Ask JARVIS anything…"} aria-label="Ask Jarvis" /><button className="send" disabled={busy} aria-label="Send command"><Send size={15} /></button></form><div className="quick">{quickCommands.map((command) => <button disabled={busy} key={command} onClick={() => void execute(command)}>{command}</button>)}</div>
      </section>
      <aside className="right-col"><section className="panel side"><p className="panel-title">Business intelligence</p>{hotLeads.length ? hotLeads.map((lead) => <div className="hot-lead" key={lead.id}><div className="hot-lead-head"><Link href={`/leads/${lead.id}`}><b>{lead.businessName}</b></Link><span className="score">{lead.score}</span></div><p>{lead.opportunitySummary}</p><span className="status">{lead.status}</span></div>) : <p className="empty">No CRM leads yet.</p>}<div className="pipeline"><p className="panel-title">Pipeline</p>{["new", "analyzed", "qualified", "contacted"].map((name) => { const count = leads.filter((lead) => lead.status === name).length; return <div className="pipe" key={name}><span>{name}</span><i style={{ maxWidth: `${Math.max(count, 1) * 12}px` }} /><b>{count}</b></div>; })}</div></section>{approval && <ApprovalCard approval={approval} onDecision={decideApproval} onEdit={editApproval} />}<Link href="/leads" className="panel side" style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 12 }}>Open CRM workspace <ArrowUpRight size={15} /></Link></aside>
    </div></main>;
}
