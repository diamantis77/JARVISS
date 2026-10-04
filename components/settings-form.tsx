"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BusinessSettings } from "@/types";
import { tr } from "@/lib/i18n";
import { VoiceDiagnostics } from "@/components/voice-diagnostics";

const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function SettingsForm({ initial, mode, onboarding = false, browserVoice = "stone" }: { initial: BusinessSettings; mode: "demo" | "live"; onboarding?: boolean; browserVoice?: "stone" | "cedar" }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (key: keyof BusinessSettings, value: string | number | string[] | boolean) => setForm((current) => ({ ...current, [key]: value }));
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, userId: undefined }) });
      const data = await result.json(); if (!result.ok) throw new Error(data.error);
      setMessage(mode === "demo" ? "Αποθηκεύτηκε μόνο για αυτό το demo αίτημα. Συνδέστε το Supabase για μόνιμη αποθήκευση." : tr("Settings saved securely."));
      if (onboarding) router.push("/"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : tr("Settings could not be saved.")); }
    finally { setBusy(false); }
  }
  return <form className="panel detail-block settings-form" onSubmit={save}>
    <p className="panel-title">{tr(onboarding ? "First-run configuration" : "Business memory")} · {mode === "live" ? "LIVE" : "DEMO"} MODE</p>
    {onboarding && <><h1>{tr("Welcome to JARVIS.")}</h1><p className="subtitle">{tr("Configure the business context JARVIS may retrieve when it is relevant.")}</p></>}
    <div className="settings-grid">
      <label>{tr("Your name")}<input value={form.fullName} onChange={(event) => update("fullName", event.target.value)} required /></label>
      <label>{tr("Business name")}<input value={form.businessName} onChange={(event) => update("businessName", event.target.value)} required /></label>
      <label>{tr("Services, comma separated")}<input value={form.companyServices.join(", ")} onChange={(event) => update("companyServices", list(event.target.value))} /></label>
      <label>{tr("Target industries")}<input value={form.targetIndustries.join(", ")} onChange={(event) => update("targetIndustries", list(event.target.value))} /></label>
      <label>{tr("Target locations")}<input value={form.targetLocations.join(", ")} onChange={(event) => update("targetLocations", list(event.target.value))} /></label>
      <label>{tr("Preferred language")}<select value={form.defaultLanguage} onChange={(event) => update("defaultLanguage", event.target.value)}><option value="el-GR">{tr("Greek")}</option><option value="en">{tr("English")}</option></select></label>
      <label>{tr("Timezone")}<input value={form.timezone} onChange={(event) => update("timezone", event.target.value)} placeholder="Europe/Athens" required /></label>
      <label>{tr("Minimum lead score")}<input type="number" min="0" max="100" value={form.minimumLeadScore} onChange={(event) => update("minimumLeadScore", Number(event.target.value))} /></label>
      <label className="wide">{tr("Company description")}<textarea rows={4} value={form.companyDescription} onChange={(event) => update("companyDescription", event.target.value)} /></label>
    </div>
    <p className="panel-title" style={{ marginTop: 26 }}>{tr("Live research controls")}</p>
    <div className="settings-grid">
      <label>{tr("Max leads per run")}<input type="number" min="1" max="50" value={form.researchMaxLeads} onChange={(event) => update("researchMaxLeads", Number(event.target.value))} /></label>
      <label>{tr("Max pages per website")}<input type="number" min="1" max="5" value={form.researchMaxPagesPerSite} onChange={(event) => update("researchMaxPagesPerSite", Number(event.target.value))} /></label>
      <label>{tr("Fetch timeout (ms)")}<input type="number" min="2000" max="20000" step="500" value={form.researchFetchTimeoutMs} onChange={(event) => update("researchFetchTimeoutMs", Number(event.target.value))} /></label>
      <label>{tr("Max concurrency")}<input type="number" min="1" max="5" value={form.researchMaxConcurrency} onChange={(event) => update("researchMaxConcurrency", Number(event.target.value))} /></label>
      <label className="wide checkbox-label"><input type="checkbox" checked={form.researchAiAnalysisEnabled} onChange={(event) => update("researchAiAnalysisEnabled", event.target.checked)} /> {tr("Enable AI interpretation after deterministic website extraction")}</label>
    </div>
    <p className="panel-title" style={{ marginTop: 26 }}>ΦΩΝΗ & WAKE MODE</p>
    <div className="settings-grid">
      <label>{tr("JARVIS voice")}<input value={`${browserVoice === "stone" ? "Stone" : "Cedar"} · φωνή browser Live`} readOnly aria-label="Ενεργή φωνή browser Live" /><small>Ρυθμίζεται στον server μέσω JARVIS_BROWSER_VOICE.</small></label>
      <label>{tr("Interaction mode")}<select value={form.voiceMode} onChange={(event) => update("voiceMode", event.target.value)}><option value="conversation">{tr("Conversation")}</option><option value="push_to_talk">{tr("Push to talk")}</option></select></label>
      <label className="wide checkbox-label"><input type="checkbox" checked={form.wakeModeEnabled} onChange={(event) => update("wakeModeEnabled", event.target.checked)} /> Ενεργοποίηση Wake Mode στον browser</label>
      <label>Wake phrase<select value={form.wakePhrase} onChange={(event) => update("wakePhrase", event.target.value)}><option value="Hey Jarvis">Hey Jarvis</option></select></label>
      <label>Προσφώνηση<input value={form.preferredFormOfAddress} onChange={(event) => update("preferredFormOfAddress", event.target.value)} placeholder="κύριε" /></label>
      <label>Timeout αδράνειας<select value={form.voiceConversationIdleTimeoutMs} onChange={(event) => update("voiceConversationIdleTimeoutMs", Number(event.target.value))}><option value={60000}>1 λεπτό</option><option value={120000}>2 λεπτά</option><option value={300000}>5 λεπτά</option><option value={600000}>10 λεπτά</option></select></label>
      <label className="wide checkbox-label"><input type="checkbox" checked={form.wakeSoundEnabled} onChange={(event) => update("wakeSoundEnabled", event.target.checked)} /> Διακριτικός ήχος ενεργοποίησης</label>
      <p className="wide settings-note">Το wake phrase επεξεργάζεται μόνο on-device όταν ο browser το υποστηρίζει ρητά. Δεν ανοίγει OpenAI Live session και δεν στέλνει ήχο στο cloud όσο ο JARVIS περιμένει.</p>
    </div>
    <VoiceDiagnostics deviceId={form.voiceMicrophoneDeviceId} language={form.defaultLanguage} onDeviceChange={(value) => update("voiceMicrophoneDeviceId", value)} />
    <p className="panel-title" style={{ marginTop: 26 }}>{tr("Daily brief")}</p>
    <div className="settings-grid"><label className="wide checkbox-label"><input type="checkbox" checked={form.dailyBriefEnabled} onChange={(event) => update("dailyBriefEnabled", event.target.checked)} /> {tr("Enable morning briefing notification")}</label><label>{tr("Brief time")}<input type="time" value={form.dailyBriefTime} onChange={(event) => update("dailyBriefTime", event.target.value)} /></label><label>{tr("Brief timezone")}<input value={form.timezone} readOnly /></label></div>
    {message && <div className="auth-message" role="status">{message}</div>}
    <button className="primary" disabled={busy} style={{ marginTop: 20 }} type="submit">{tr(busy ? "Saving…" : onboarding ? "JARVIS is ready" : "Save business memory")}</button>
  </form>;
}
