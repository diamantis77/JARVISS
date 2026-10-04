"use client";
import { CloudOff, LogOut, Mic, MicOff, Minimize2, Radio, Send, Settings, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { JarvisCore } from "@/components/jarvis-core";
import { RunProgress } from "@/components/run-progress";
import { ApprovalCard } from "@/components/approval-card";
import { signOut } from "@/app/auth/actions";
import { BrowserVoiceProvider } from "@/lib/voice/browser-provider";
import { BrowserLocalWakeWordProvider } from "@/lib/voice/browser-wake-word-provider";
import { activationTone, buildActivationGreeting, extractWakeCommand } from "@/lib/voice/wake-word";
import { isResearchProgressEvent } from "@/lib/voice/research-handoff";
import type { VoiceHistoryMessage } from "@/lib/voice/conversation-history";
import { NotificationCenter } from "@/components/notification-center";
import type { Activity, Approval, JarvisNotification, JarvisRun, JarvisState, Lead, Task } from "@/types";
import type { VoiceSnapshot } from "@/lib/voice/contracts";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE, localizeStatus, tr } from "@/lib/i18n";
import { aggregateBusinessIntelligence } from "@/lib/business-intelligence";
import { getCoreAudioEnergy, getCoreVisualState, getOperationLabel, smoothCoreAudioEnergy, type CoreAudioEnergy } from "@/lib/presentation/core-state";
import { EXPERIENCE_TIMING, keepDashboardOpenAfterVoiceEnd, nextExperienceMode, type ExperienceMode } from "@/lib/presentation/experience-state";
import type { WeatherSnapshot } from "@/lib/weather/contracts";
import { formatSpokenBriefing, shouldDeliverFullBriefing, type BriefingSnapshot } from "@/lib/briefing";
import { defaultPersonalJarvisPreferences, parsePersonalJarvisPreferences, PERSONAL_PREFERENCES_KEY } from "@/lib/personal-preferences";
import { ClosingPanel, FinancePanel, ModulesPanel, OpportunityPanel, PipelinePanel, PrioritiesPanel, RecentActivityPanel, TodayPanel, type CommandProviderStatus } from "@/components/command-center-panels";
import { CommandRail, LeadHud, MissionHud, QuickActionsHud, ScheduleHud } from "@/components/command-center-hud";
import { shouldRefreshAfterRun } from "@/lib/presentation/refresh-policy";
import { selectPendingApproval } from "@/lib/presentation/pending-approval";

const quickCommands = [{ label: "Βρες πελάτες", command: "Βρες νέους κατάλληλους πελάτες" }, { label: "Δείξε hot leads", command: "Δείξε μου τα ισχυρότερα leads μου" }, { label: "Σημερινό briefing", command: "Δώσε μου το σημερινό business briefing" }, { label: "Έλεγχος email", command: "Έλεγξε τα σημαντικά email" }, { label: "Ημερολόγιο", command: "Τι έχω σήμερα στο ημερολόγιο;" }, { label: "Εκκρεμείς εγκρίσεις", command: "Δείξε μου τις εκκρεμείς εγκρίσεις" }];
const initialVoice: VoiceSnapshot = { state: "idle", muted: false, inputLevel: 0, outputLevel: 0, error: null };
const activeVoiceStates = new Set(["requesting_microphone", "connecting", "listening", "user_speaking", "processing", "jarvis_speaking", "interrupted", "reconnecting"]);
const wakeVoiceStates = new Set(["wake_initializing", "wake_waiting", "wake_detected"]);
type VoiceSettings = { wakeModeEnabled: boolean; wakePhrase: "Hey Jarvis"; wakeSoundEnabled: boolean; preferredFormOfAddress: string; timezone: string; defaultLanguage: string; microphoneDeviceId: string };
interface CommandCenterProps { mode: "demo" | "live"; aiMode: "demo" | "routed" | "unavailable"; researchMode: "demo" | "live" | "disabled"; voiceEnabled: boolean; voiceSettings: VoiceSettings; providerStatus: CommandProviderStatus; weather: WeatherSnapshot; briefing: BriefingSnapshot; leads: Lead[]; activities: Activity[]; tasks: Task[]; approvals: Approval[]; notifications: JarvisNotification[]; initialRun: JarvisRun; initialCommand?: string }
type StreamEvent = { type: "run" | "step" | "approval" | "complete" | "error"; run?: JarvisRun; approval?: Approval; message?: string; research?: { researchRunId: string; status: string } };
type VoiceTurn = { id: string; user: string; assistant: string };

const timeFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: DEFAULT_TIMEZONE });
const dateFormatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: DEFAULT_TIMEZONE });

function CommandCenterClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_050 - Date.now() % 60_000);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return <div className="cc-datetime"><small>{now ? dateFormatter.format(now) : "Europe/Athens"}</small><b>{now ? timeFormatter.format(now) : "--:--"}</b></div>;
}

export function CommandCenter({ mode, aiMode, researchMode, voiceEnabled, voiceSettings, providerStatus, weather, briefing, leads, activities, tasks, approvals, notifications, initialRun, initialCommand = "" }: CommandCenterProps) {
  const router = useRouter();
  const [input, setInput] = useState(initialCommand); const [state, setState] = useState<JarvisState>("idle");
  const [run, setRun] = useState(initialRun); const [showDetails, setShowDetails] = useState(false); const [approval, setApproval] = useState<Approval | null>(approvals[0] ?? null);
  useEffect(() => { setApproval((current) => selectPendingApproval(current, approvals)); }, [approvals]);
  const [response, setResponse] = useState(initialRun.summary); const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<VoiceSnapshot>(initialVoice); const [partial, setPartial] = useState(""); const [voiceTurns, setVoiceTurns] = useState<VoiceTurn[]>([]); const [wakeRuntimeEnabled, setWakeRuntimeEnabled] = useState(false); const [experienceMode, setExperienceMode] = useState<ExperienceMode>("standby");
  const [personalPreferences, setPersonalPreferences] = useState(defaultPersonalJarvisPreferences); const [currentWeather, setCurrentWeather] = useState(weather); const [briefingActive, setBriefingActive] = useState(false);
  const cancelRequested = useRef(false); const busyRef = useRef(false); const providerRef = useRef<BrowserVoiceProvider | null>(null); const wakeProviderRef = useRef<BrowserLocalWakeWordProvider | null>(null); const wakeRuntimeRef = useRef(false); const voiceTurnsRef = useRef<VoiceTurn[]>([]); const voiceHistoryRef = useRef<VoiceHistoryMessage[]>([]); const activationStartedAt = useRef(0); const experienceTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const toggleVoiceRef = useRef<() => Promise<void>>(async () => {});
  const activateCore = useCallback(() => { void toggleVoiceRef.current(); }, []);
  const coreStageRef = useRef<HTMLElement | null>(null);
  const coreFlightFrom = useRef<DOMRect | null>(null);
  const lastVoiceState = useRef<VoiceSnapshot>(initialVoice);
  const displayedCoreEnergy = useRef<CoreAudioEnergy>({ input: 0, output: 0, energy: 0 });
  const activeResearchId = useRef<string | null>(typeof initialRun.context?.researchRunId === "string" ? initialRun.context.researchRunId : null);
  const financialSummary = useMemo(() => aggregateBusinessIntelligence(leads), [leads]);
  const voiceActive = activeVoiceStates.has(voice.state);
  const wakeActive = wakeVoiceStates.has(voice.state);
  function updateVoiceVisual(snapshot: VoiceSnapshot) {
    const visual = getCoreVisualState("idle", snapshot.state);
    const levels = smoothCoreAudioEnergy(displayedCoreEnergy.current, getCoreAudioEnergy(visual, snapshot.inputLevel, snapshot.outputLevel), visual);
    displayedCoreEnergy.current = levels;
    const stage = coreStageRef.current;
    if (stage) {
      stage.style.setProperty("--input-level", String(levels.input));
      stage.style.setProperty("--output-level", String(levels.output));
      stage.style.setProperty("--core-energy", String(levels.energy));
    }
    const previous = lastVoiceState.current;
    lastVoiceState.current = snapshot;
    if (snapshot.state !== previous.state || snapshot.muted !== previous.muted || snapshot.error !== previous.error) {
      setVoice({ ...snapshot, inputLevel: 0, outputLevel: 0 });
      if (["listening", "user_speaking", "processing", "jarvis_speaking"].includes(snapshot.state)) markVoiceReady();
      if (snapshot.error && snapshot.error !== previous.error) setResponse(snapshot.error);
    }
  }
  useEffect(() => {
    const preferences = parsePersonalJarvisPreferences(localStorage.getItem(PERSONAL_PREFERENCES_KEY));
    setPersonalPreferences(preferences);
    const loadWeather = async (body: Record<string, unknown>) => {
      const result = await fetch("/api/weather", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
      if (!result?.ok) return;
      const data = await result.json() as { weather?: WeatherSnapshot };
      if (data.weather) setCurrentWeather(data.weather);
    };
    if (preferences.automaticLocation && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => void loadWeather({ latitude: position.coords.latitude, longitude: position.coords.longitude }), () => { if (preferences.manualCity) void loadWeather({ location: preferences.manualCity }); }, { enableHighAccuracy: false, maximumAge: 30 * 60_000, timeout: 8_000 });
    } else if (preferences.manualCity) void loadWeather({ location: preferences.manualCity });
    const markActive = () => localStorage.setItem("jarvis:last-active-at", new Date().toISOString());
    window.addEventListener("pagehide", markActive);
    return () => { markActive(); window.removeEventListener("pagehide", markActive); };
  }, []);
  useEffect(() => {
    const stored = localStorage.getItem("jarvis:wake-runtime-enabled");
    const shouldResume = voiceEnabled && voiceSettings.wakeModeEnabled && stored !== "false";
    if (shouldResume) { wakeRuntimeRef.current = true; setWakeRuntimeEnabled(true); window.setTimeout(() => void resumeWakeMode(), 0); }
    return () => { wakeRuntimeRef.current = false; if (experienceTimer.current) clearTimeout(experienceTimer.current); void wakeProviderRef.current?.stop(); void providerRef.current?.stopSession(); };
    // Voice settings are server-owned for the lifetime of this mounted command center.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (experienceMode !== "activating" || !coreFlightFrom.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const visual = coreStageRef.current?.querySelector<SVGSVGElement>(".jarvis-core-visual");
    const from = coreFlightFrom.current;
    coreFlightFrom.current = null;
    if (!visual) return;
    const to = visual.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const x = from.left + from.width / 2 - to.left - to.width / 2;
    const y = from.top + from.height / 2 - to.top - to.height / 2;
    visual.animate([
      { transform: `translate(${x}px, ${y}px) scale(${from.width / to.width})`, opacity: .86 },
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
    ], { duration: EXPERIENCE_TIMING.activationMinimumMs, easing: "cubic-bezier(.2, .76, .2, 1)" });
  }, [experienceMode]);

  function beginActivation() { if (experienceTimer.current) clearTimeout(experienceTimer.current); coreFlightFrom.current = coreStageRef.current?.querySelector(".jarvis-core-visual")?.getBoundingClientRect() ?? null; activationStartedAt.current = performance.now(); setExperienceMode((current) => nextExperienceMode(current, "ACTIVATE")); }
  function openDashboard() {
    beginActivation();
    experienceTimer.current = setTimeout(() => setExperienceMode((current) => nextExperienceMode(current, "VOICE_READY")), EXPERIENCE_TIMING.activationMinimumMs);
  }
  function openPendingApproval() {
    openDashboard();
    window.setTimeout(() => document.getElementById("approvals")?.scrollIntoView({ behavior: "smooth", block: "center" }), EXPERIENCE_TIMING.activationMinimumMs + 80);
  }
  function markVoiceReady() {
    const wait = Math.max(0, EXPERIENCE_TIMING.activationMinimumMs - (performance.now() - activationStartedAt.current));
    if (experienceTimer.current) clearTimeout(experienceTimer.current);
    experienceTimer.current = setTimeout(() => setExperienceMode((current) => nextExperienceMode(current, "VOICE_READY")), wait);
  }
  function collapseToStandby(failed = false) {
    if (experienceTimer.current) clearTimeout(experienceTimer.current);
    setExperienceMode((current) => nextExperienceMode(current, failed ? "FAILURE" : "REQUEST_STANDBY"));
    experienceTimer.current = setTimeout(() => {
      setExperienceMode((current) => nextExperienceMode(current, "ANIMATION_COMPLETE"));
      setState("idle");
      if (wakeRuntimeRef.current) void resumeWakeMode();
    }, EXPERIENCE_TIMING.collapseMs);
  }

  async function consumeStream(result: Response) {
    if (!result.ok || !result.body) { const error = await result.json().catch(() => ({ error: "Ο JARVIS δεν μπόρεσε να ξεκινήσει αυτή την εκτέλεση." })); throw new Error(error.error); }
    const reader = result.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let latestRun: JarvisRun | null = null; let finalMessage = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue; const event = JSON.parse(line) as StreamEvent;
        if (event.run) { latestRun = event.run; setRun(event.run); const id = event.run.context?.researchRunId; if (typeof id === "string") activeResearchId.current = id; }
        if (event.research?.researchRunId) activeResearchId.current = event.research.researchRunId;
        if (event.type === "run") setState("thinking");
        if (event.type === "step" || isResearchProgressEvent(event)) setState("executing");
        if (event.type === "approval") { setState("idle"); if (event.approval) setApproval(event.approval); finalMessage = event.message ?? "Η ενέργεια απαιτεί έγκριση."; setResponse(finalMessage); }
        if (event.type === "complete") { setState("success"); finalMessage = event.message ?? event.run?.summary ?? "Η εκτέλεση ολοκληρώθηκε."; setResponse(finalMessage); }
        if (event.type === "error") { setState("error"); finalMessage = event.message ?? "Ο JARVIS δεν μπόρεσε να ολοκληρώσει αυτή την εκτέλεση."; setResponse(finalMessage); }
      }
    }
    return { latestRun, finalMessage: finalMessage || latestRun?.summary || "Ο JARVIS ολοκλήρωσε την εντολή." };
  }

  async function continueResearch(latestRun: JarvisRun | null) {
    let current = latestRun; let batchCount = 0;
    try {
      while (!cancelRequested.current && activeResearchId.current && current?.context?.researchStatus === "partial" && batchCount < 20) {
        batchCount += 1; setState("executing"); setResponse(`Η πρόοδος της έρευνας αποθηκεύτηκε. Συνέχεια με παρτίδα ${batchCount + 1}…`);
        const result = await consumeStream(await fetch(`/api/research/${encodeURIComponent(activeResearchId.current)}/continue`, { method: "POST" })); current = result.latestRun;
      }
      if (!cancelRequested.current && current?.context?.researchStatus === "partial") setResponse("Η πρόοδος της έρευνας αποθηκεύτηκε και μπορεί να συνεχιστεί με ασφάλεια.");
    } catch (error) { setState("error"); setResponse(error instanceof Error ? error.message : "Ο JARVIS δεν μπόρεσε να συνεχίσει αυτή την έρευνα."); }
    finally { busyRef.current = false; setBusy(false); router.refresh(); }
  }

  async function execute(command: string, voiceMeta?: { sessionId: string; commandId: string }) {
    if (!command.trim()) return "Δεν έλαβα εντολή.";
    if (busyRef.current) return /[Α-ω]/u.test(command) ? "Ο JARVIS εκτελεί ήδη μια εντολή. Η φωνητική συνεδρία παραμένει ενεργή." : "JARVIS is already executing a command. The voice session remains active.";
    cancelRequested.current = false; activeResearchId.current = null; busyRef.current = true; setBusy(true); setState("thinking"); setResponse("Ο JARVIS ελέγχει την εντολή και προετοιμάζει το πλαίσιο εκτέλεσης.");
    if (!voiceMeta) setInput("");
    try {
      const voiceContext = voiceTurnsRef.current.slice(-4).flatMap((turn) => [{ role: "user" as const, text: turn.user }, { role: "assistant" as const, text: turn.assistant }]);
      const body = voiceMeta ? { command, source: "voice", voiceSessionId: voiceMeta.sessionId, voiceCommandId: voiceMeta.commandId, voiceContext } : { command };
      const result = await consumeStream(await fetch("/api/jarvis/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      if (activeResearchId.current && result.latestRun?.context?.researchStatus === "partial") {
        if (voiceMeta) { void continueResearch(result.latestRun); return `${result.finalMessage} Θα συνεχίσω την υπόλοιπη έρευνα στο παρασκήνιο.`; }
        await continueResearch(result.latestRun); return result.finalMessage;
      }
      busyRef.current = false; setBusy(false); if (shouldRefreshAfterRun(result.latestRun)) router.refresh(); return result.finalMessage;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ο JARVIS δεν μπόρεσε να ολοκληρώσει αυτή την εκτέλεση."; setState("error"); setResponse(message); busyRef.current = false; setBusy(false); throw new Error(message);
    }
  }

  async function resumeWakeMode() {
    if (!wakeRuntimeRef.current || !voiceSettings.wakeModeEnabled || !voiceEnabled) return;
    let handingOff = false;
    const wakeProvider = new BrowserLocalWakeWordProvider({
      onState: (snapshot) => {
        // Stopping the local recognizer during handoff must not flash the core back to idle.
        if (handingOff && snapshot.state === "idle") return;
        updateVoiceVisual({ state: snapshot.state, muted: false, inputLevel: snapshot.inputLevel, outputLevel: 0, error: snapshot.error });
        if (snapshot.error) { setResponse(snapshot.error); wakeRuntimeRef.current = false; setWakeRuntimeEnabled(false); wakeProviderRef.current = null; collapseToStandby(true); }
      },
      onDetected: async (transcript) => {
        beginActivation();
        handingOff = true;
        const sharedStream = await wakeProvider.handoffStream();
        await wakeProvider.stop({ preserveStream: true }); wakeProviderRef.current = null;
        if (!sharedStream?.getAudioTracks().some((track) => track.readyState === "live")) throw new Error("Wake microphone stream lost during handoff");
        if (voiceSettings.wakeSoundEnabled) { try { const context = new AudioContext(); await context.resume(); activationTone(context); window.setTimeout(() => void context.close().catch(() => undefined), 300); } catch { /* The visual/voice handoff is more important than the optional cue. */ } }
        const now = new Date();
        const snapshot = { ...briefing, generatedAt: now.toISOString(), weather: currentWeather };
        let saved: { at?: string; period?: string; signature?: string } = {};
        try { saved = JSON.parse(localStorage.getItem("jarvis:last-briefing") ?? "{}"); } catch { localStorage.removeItem("jarvis:last-briefing"); }
        const fullBriefing = personalPreferences.automaticBriefing && shouldDeliverFullBriefing({ snapshot, lastBriefingAt: saved.at, lastBriefingPeriod: saved.period });
        let commentary: string;
        if (fullBriefing) {
          commentary = formatSpokenBriefing(snapshot, { address: voiceSettings.preferredFormOfAddress, preferences: { enabled: true, length: personalPreferences.briefingLength, includeWeather: personalPreferences.briefingWeather, includeCalendar: personalPreferences.briefingCalendar, includeBusiness: personalPreferences.briefingBusiness, includeEmail: personalPreferences.briefingEmail } });
          const lastActiveAt = Date.parse(localStorage.getItem("jarvis:last-active-at") ?? "");
          if (Number.isFinite(lastActiveAt)) {
            const newReplies = notifications.filter((item) => ["EMAIL_REPLY", "HOT_LEAD_REPLY"].includes(item.type) && Date.parse(item.createdAt) > lastActiveAt).length;
            const newMeetings = notifications.filter((item) => ["MEETING_REQUEST", "UPCOMING_MEETING"].includes(item.type) && Date.parse(item.createdAt) > lastActiveAt).length;
            const newResearch = activities.filter((item) => /research|έρευν/i.test(`${item.title} ${item.description}`) && Date.parse(item.time) > lastActiveAt).length;
            const newLeads = leads.filter((item) => Date.parse(item.lastActivity) > lastActiveAt).length;
            const changes = [[newReplies, "νέα replies"], [newLeads, "νέα leads"], [newResearch, "research ολοκληρώθηκαν"], [newMeetings, "νέα meetings"]] as const;
            const changed = changes.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).slice(0, 3);
            if (changed.length) commentary += ` Από την τελευταία φορά: ${changed.join(", ")}.`;
          }
          localStorage.setItem("jarvis:last-briefing", JSON.stringify({ at: now.toISOString(), period: snapshot.period, signature: snapshot.majorSignature }));
          setBriefingActive(true); window.setTimeout(() => setBriefingActive(false), 8_000);
        } else if (saved.signature && saved.signature !== snapshot.majorSignature) commentary = `Έχω μία νέα σημαντική ενημέρωση. Σας ακούω, ${voiceSettings.preferredFormOfAddress}.`;
        else {
          const lastGreetingKey = sessionStorage.getItem("jarvis:last-greeting-key");
          const greeting = buildActivationGreeting({ now, timezone: voiceSettings.timezone, formOfAddress: voiceSettings.preferredFormOfAddress, lastGreetingKey });
          sessionStorage.setItem("jarvis:last-greeting-key", greeting.greetingKey); commentary = greeting.text;
        }
        const capturedCommand = extractWakeCommand(transcript);
        setResponse(commentary);
        await startLiveSession(commentary, capturedCommand || undefined, sharedStream);
      },
    });
    wakeProviderRef.current = wakeProvider; await wakeProvider.start({ phrase: voiceSettings.wakePhrase, language: voiceSettings.defaultLanguage, microphoneDeviceId: voiceSettings.microphoneDeviceId, sensitivity: personalPreferences.wakeSensitivity, speechThreshold: personalPreferences.calibration?.speechThreshold });
  }

  async function startLiveSession(initialCommentary?: string, initialCommand?: string, initialStream?: MediaStream | null) {
    if (!voiceEnabled) { setResponse("Η φωνητική συνομιλία δεν είναι διαθέσιμη σε αυτό το περιβάλλον. Η λειτουργία κειμένου παραμένει πλήρως διαθέσιμη."); setState("error"); collapseToStandby(true); return; }
    if (providerRef.current) return;
    const provider = new BrowserVoiceProvider({
      onState: updateVoiceVisual,
      onPartialTranscript: setPartial,
      onHistoryUpdate: (history) => { voiceHistoryRef.current = history; },
      onCommand: (transcript, commandId, sessionId) => execute(transcript, { sessionId, commandId }),
      onFinalTurn: (user, assistant) => { setVoiceTurns((turns) => { const next = [...turns.slice(-3), { id: crypto.randomUUID(), user, assistant }]; voiceTurnsRef.current = next; return next; }); setPartial(""); },
      onConversationEnded: (reason) => {
        if (providerRef.current !== provider) return;
        providerRef.current = null;
        if (keepDashboardOpenAfterVoiceEnd(reason)) {
          if (experienceTimer.current) clearTimeout(experienceTimer.current);
          setExperienceMode((current) => nextExperienceMode(current, "VOICE_READY"));
          if (wakeRuntimeRef.current) void resumeWakeMode();
          else updateVoiceVisual(initialVoice);
          return;
        }
        collapseToStandby(reason === "failure");
      },
    }, { initialCommentary, initialCommand, initialHistory: voiceHistoryRef.current.length ? voiceHistoryRef.current : voiceTurnsRef.current.flatMap((turn) => [{ role: "user" as const, text: turn.user }, { role: "assistant" as const, text: turn.assistant }]), initialStream, microphoneDeviceId: voiceSettings.microphoneDeviceId, speechThreshold: personalPreferences.calibration?.speechThreshold });
    providerRef.current = provider; await provider.startSession();
  }

  async function toggleVoice() {
    if (providerRef.current) { await providerRef.current.stopSession("tap"); return; }
    if (wakeProviderRef.current) { await wakeProviderRef.current.stop(); wakeProviderRef.current = null; }
    beginActivation();
    await startLiveSession("Σας ακούω.");
  }
  useLayoutEffect(() => { toggleVoiceRef.current = toggleVoice; });

  async function toggleWakeMode() {
    if (!voiceEnabled) { setResponse("Το Wake Mode χρειάζεται ενεργή Live φωνή. Ελέγξτε τις ρυθμίσεις φωνής και τη σύνδεση."); return; }
    if (!voiceSettings.wakeModeEnabled) { setResponse("Ενεργοποιήστε πρώτα το Wake Mode από Ρυθμίσεις → Φωνή & Wake Mode."); return; }
    const next = !wakeRuntimeRef.current; wakeRuntimeRef.current = next; setWakeRuntimeEnabled(next);
    localStorage.setItem("jarvis:wake-runtime-enabled", String(next));
    if (!next) { await wakeProviderRef.current?.stop(); wakeProviderRef.current = null; if (wakeActive) updateVoiceVisual(initialVoice); return; }
    if (!voiceActive) await resumeWakeMode();
  }
  function toggleMute() { const provider = providerRef.current; if (!provider) return; if (voice.muted) provider.unmute(); else provider.mute(); }
  async function enterCoreMode() { if (providerRef.current) await providerRef.current.stopSession("manual"); else collapseToStandby(); }

  async function cancelResearch() {
    const id = activeResearchId.current; if (!id) return; cancelRequested.current = true; setResponse("Ακύρωση μετά το τρέχον ασφαλές σημείο αποθήκευσης…");
    try { const result = await fetch(`/api/research/${encodeURIComponent(id)}/cancel`, { method: "POST" }); const data = await result.json(); if (!result.ok) throw new Error(data.error); if (data.run) setRun(data.run); setState("idle"); setResponse(data.message); }
    catch (error) { setState("error"); setResponse(error instanceof Error ? error.message : "Δεν ήταν δυνατή η ακύρωση της έρευνας."); }
  }
  async function decideApproval(decision: "approved" | "rejected") { if (!approval) return; try { const result = await fetch(`/api/approvals/${approval.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) }); const data = await result.json(); if (!result.ok) throw new Error(data.error); setApproval(null); if (data.run) setRun(data.run); setResponse(data.message); setState(data.run?.status === "failed" ? "error" : decision === "approved" ? "success" : "idle"); router.refresh(); } catch (error) { setState("error"); setResponse(error instanceof Error ? error.message : "Δεν ήταν δυνατή η ολοκλήρωση της έγκρισης."); } }
  async function editApproval(patch: { subject: string; preview: string }) { if (!approval) return; const result = await fetch(`/api/approvals/${approval.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }); const data = await result.json(); if (!result.ok) throw new Error(data.error); setApproval(data.approval); setResponse(data.message); }

  const activeStep = [...run.steps].reverse().find((step) => step.status === "running" || step.status === "waiting_for_approval") ?? run.steps.find((step) => step.order === run.currentStep);
  const operation = state === "executing" ? getOperationLabel(activeStep?.toolName) : null;
  const modeLabel = tr(mode === "demo" ? "DEMO MODE · FICTIONAL DATA" : aiMode === "routed" ? researchMode === "live" ? "LIVE MODE · WORKSPACE + RESEARCH" : "LIVE MODE · WORKSPACE" : "LIVE DATA · AI NOT CONFIGURED");
  const expanded = experienceMode !== "standby";
  const researchProcessed = typeof run.context?.researchProcessed === "number" ? run.context.researchProcessed : null;
  const researchTotal = typeof run.context?.researchTotal === "number" ? run.context.researchTotal : null;
  const hasActionAlert = Boolean(approval) || notifications.some((item) => !item.readAt && ["important", "urgent"].includes(item.priority));
  return <main className={`command-center-shell experience-${experienceMode} ${voiceActive ? "voice-focus" : ""} ${briefingActive ? "briefing-active" : ""}`}>
    {expanded && <header className="cc-topbar">
      <Link href="/" className="cc-brand" aria-label="JARVIS Κέντρο Ελέγχου"><span className="cc-brand-mark"><i /><i /><i /></span><span><b>JARVIS</b><small>BUSINESS OPERATING SYSTEM</small></span></Link>
      <CommandCenterClock />
      <div className="cc-context"><div className="hud-top-status"><span><i className={mode === "live" ? "ok" : ""} />SUPABASE <small>{mode === "live" ? "Live" : "Demo"}</small></span><span><i className={aiMode === "routed" ? "ok" : ""} />AI ROUTER <small>{aiMode === "routed" ? "Configured" : aiMode === "demo" ? "Demo" : "Unavailable"}</small></span><span><i />VONAGE <small>Έλεγχος στις Ρυθμίσεις</small></span><span><i />WORKER <small>Έλεγχος στις Λειτουργίες</small></span><span><i />SCHEDULER <small>Έλεγχος στις Λειτουργίες</small></span></div><NotificationCenter initial={notifications} /><button className="cc-core-mode" type="button" onClick={() => void enterCoreMode()}><Minimize2 size={13} />CORE MODE</button><Link href="/settings" className="icon-link" aria-label={tr("Settings")}><Settings size={14} /></Link>{mode === "live" && <form action={signOut}><button className="icon-link" aria-label={tr("Sign out")}><LogOut size={14} /></button></form>}</div>
    </header>}
    {expanded && <div className="cc-mode-strip"><span>{modeLabel}</span><i /><small>EL-GR · EUROPE/ATHENS</small></div>}
    {expanded && <CommandRail />}
    <div className="cc-layout">
      {expanded && <aside className="cc-left"><section className="cc-panel hud-weather"><div className="cc-panel-head"><span>{currentWeather.location ?? "ΚΑΙΡΟΣ"}</span><small>{currentWeather.status === "available" ? "LIVE" : "—"}</small></div>{currentWeather.status === "available" ? <div><b>{Math.round(currentWeather.temperatureC)}°</b><span>{currentWeather.condition}<small>{currentWeather.lowC !== null && currentWeather.highC !== null ? `${Math.round(currentWeather.lowC)}° / ${Math.round(currentWeather.highC)}°` : ""}</small></span></div> : <div><CloudOff size={24} /><span>Καιρός μη διαθέσιμος</span></div>}</section><ScheduleHud tasks={tasks} /><RecentActivityPanel activities={activities} /><ModulesPanel mode={mode} voiceEnabled={voiceEnabled} wakeEnabled={wakeRuntimeEnabled} researchMode={researchMode} providers={providerStatus} /><TodayPanel mode={mode} leads={leads} tasks={tasks} approvals={approvals} notifications={notifications} /><PrioritiesPanel tasks={tasks} approvals={approvals} notifications={notifications} /></aside>}
      <section className="cc-cockpit">
        <div className="cc-projection-lines" aria-hidden="true"><i /><i /><i /><i /></div>
        <JarvisCore stageRef={coreStageRef} state={expanded ? state : "idle"} voiceState={voice.state} operation={expanded ? operation : null} onActivate={activateCore} voiceActive={voiceActive} />
        {!expanded && <section className={`cc-standby-controls ${hasActionAlert ? "has-alert" : ""}`} aria-live="polite"><span>{wakeActive ? `ΑΝΑΜΟΝΗ ΓΙΑ «${voiceSettings.wakePhrase.toLocaleUpperCase("el-GR")}»` : voice.error ?? "CORE STANDBY"}</span>{wakeActive && <small>LIVE ΚΛΕΙΣΤΟ · ΜΟΝΟ ΤΟΠΙΚΗ ΑΝΙΧΝΕΥΣΗ WAKE</small>}{approval && <button type="button" className="cc-pending-approval" onClick={openPendingApproval}>ΕΚΚΡΕΜΕΙ ΕΓΚΡΙΣΗ EMAIL · ΠΡΟΒΟΛΗ</button>}<div><button type="button" onClick={openDashboard}>ΑΝΟΙΓΜΑ ΚΕΝΤΡΟΥ ΕΛΕΓΧΟΥ</button><button className={wakeRuntimeEnabled ? "wake-on" : ""} type="button" onClick={() => void toggleWakeMode()}><Radio size={13} />{wakeRuntimeEnabled ? "WAKE ON" : "ΕΝΕΡΓΟΠΟΙΗΣΗ WAKE"}</button><button type="button" onClick={() => void toggleVoice()}><Mic size={13} />ΧΕΙΡΟΚΙΝΗΤΗ ΕΝΑΡΞΗ</button></div></section>}
        {expanded && <>
          {researchProcessed !== null && researchTotal !== null && researchTotal > 0 && <div className="cc-research-progress" aria-label={`Πρόοδος έρευνας ${researchProcessed} από ${researchTotal}`}><span>ΕΡΕΥΝΑ · {researchProcessed}/{researchTotal}</span><i><em style={{ width: `${Math.min(100, Math.round((researchProcessed / researchTotal) * 100))}%` }} /></i></div>}
          <section className="cc-response" aria-live="polite"><span>JARVIS · ΕΝΗΜΕΡΩΣΗ</span><p>{response}</p><div><button className="primary" disabled={busy} onClick={() => void execute("Προετοίμασε επικοινωνία για το ισχυρότερο lead μου")}>{tr("Prepare outreach")}</button><Link href="/leads" className="secondary">{tr("View leads")}</Link>{busy && activeResearchId.current && <button className="secondary danger" onClick={() => void cancelResearch()}><Square size={11} /> {tr("Cancel research")}</button>}</div></section>
          <section className="cc-command-deck"><div className="cc-command-status"><span><i className={`voice-dot ${wakeActive ? "wake" : ""}`} />{localizeStatus(voice.state)}</span><button className={wakeRuntimeEnabled ? "wake-on" : ""} type="button" onClick={() => void toggleWakeMode()} aria-pressed={wakeRuntimeEnabled}><Radio size={13} />{wakeRuntimeEnabled ? "WAKE ON" : "WAKE OFF"}</button></div><form className="cc-command" onSubmit={(event) => { event.preventDefault(); void execute(input); }}><button className={`cc-mic ${voiceActive || wakeActive ? "active" : ""}`} type="button" aria-label={tr(voiceActive ? "Stop voice session" : "Start realtime voice")} aria-pressed={voiceActive} onClick={() => void toggleVoice()}>{voiceActive ? <Square size={15} /> : <Mic size={18} />}</button><input value={input} disabled={busy} onChange={(event) => setInput(event.target.value)} placeholder={tr(busy ? "JARVIS is working…" : "Ask JARVIS anything…")} aria-label="Ρωτήστε τον JARVIS" /><button className="cc-send" disabled={busy} aria-label={tr("Send command")}><Send size={17} /></button></form><div className="cc-quick">{quickCommands.map((item) => <button type="button" disabled={busy} key={item.label} onClick={() => void execute(item.command)}>{item.label}</button>)}</div></section>
          {(voiceTurns.length > 0 || partial || wakeActive) && <section className="voice-transcript cc-voice-transcript" aria-live="polite"><div className="voice-head"><span><i className={`voice-dot ${wakeActive ? "wake" : ""}`} />{localizeStatus(voice.state)}</span>{voiceActive && <button type="button" onClick={toggleMute} aria-label={tr(voice.muted ? "Unmute microphone" : "Mute microphone")}>{voice.muted ? <MicOff size={13} /> : <Volume2 size={13} />}{tr(voice.muted ? "Unmute" : "Mute")}</button>}</div>{wakeActive && <p className="wake-privacy"><b>ΤΟΠΙΚΗ ΑΝΑΜΟΝΗ</b> Πείτε «{voiceSettings.wakePhrase}». Δεν υπάρχει ενεργή OpenAI συνεδρία.</p>}{voiceTurns.map((turn) => <div className="voice-turn" key={turn.id}><p><b>ΕΣΕΙΣ</b>{turn.user}</p><p><b>JARVIS</b>{turn.assistant}</p></div>)}{partial && <p className="voice-partial"><b>ΕΣΕΙΣ · ΣΑΣ ΑΚΟΥΩ</b>{partial}</p>}</section>}
          <div className="cc-intelligence-grid"><FinancePanel summary={financialSummary} /><PipelinePanel summary={financialSummary} /></div>
          <RunProgress run={run} expanded={showDetails} onToggle={() => setShowDetails(!showDetails)} />
        </>}
      </section>
      {expanded && <aside className="cc-right">{approval && <div id="approvals"><ApprovalCard approval={approval} onDecision={decideApproval} onEdit={editApproval} /></div>}<MissionHud mode={mode} /><QuickActionsHud onMic={() => void toggleVoice()} /><LeadHud leads={leads} /><OpportunityPanel leads={leads} /><ClosingPanel summary={financialSummary} /></aside>}
    </div>
  </main>;
}
