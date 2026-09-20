"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BusinessSettings } from "@/types";

const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function SettingsForm({ initial, mode, onboarding = false }: { initial: BusinessSettings; mode: "demo" | "live"; onboarding?: boolean }) {
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
      setMessage(mode === "demo" ? "Saved for this demo request only. Connect Supabase for persistence." : "Settings saved securely.");
      if (onboarding) router.push("/"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Settings could not be saved."); }
    finally { setBusy(false); }
  }
  return <form className="panel detail-block settings-form" onSubmit={save}>
    <p className="panel-title">{onboarding ? "First-run configuration" : "Business memory"} · {mode} mode</p>
    {onboarding && <><h1>Welcome to JARVIS.</h1><p className="subtitle">Configure the business context JARVIS may retrieve when it is relevant.</p></>}
    <div className="settings-grid">
      <label>Your name<input value={form.fullName} onChange={(event) => update("fullName", event.target.value)} required /></label>
      <label>Business name<input value={form.businessName} onChange={(event) => update("businessName", event.target.value)} required /></label>
      <label>Services, comma separated<input value={form.companyServices.join(", ")} onChange={(event) => update("companyServices", list(event.target.value))} /></label>
      <label>Target industries<input value={form.targetIndustries.join(", ")} onChange={(event) => update("targetIndustries", list(event.target.value))} /></label>
      <label>Target locations<input value={form.targetLocations.join(", ")} onChange={(event) => update("targetLocations", list(event.target.value))} /></label>
      <label>Preferred language<select value={form.defaultLanguage} onChange={(event) => update("defaultLanguage", event.target.value)}><option value="en">English</option><option value="el">Greek</option></select></label>
      <label>Minimum lead score<input type="number" min="0" max="100" value={form.minimumLeadScore} onChange={(event) => update("minimumLeadScore", Number(event.target.value))} /></label>
      <label className="wide">Company description<textarea rows={4} value={form.companyDescription} onChange={(event) => update("companyDescription", event.target.value)} /></label>
    </div>
    <p className="panel-title" style={{ marginTop: 26 }}>Live research controls</p>
    <div className="settings-grid">
      <label>Max leads per run<input type="number" min="1" max="50" value={form.researchMaxLeads} onChange={(event) => update("researchMaxLeads", Number(event.target.value))} /></label>
      <label>Max pages per website<input type="number" min="1" max="5" value={form.researchMaxPagesPerSite} onChange={(event) => update("researchMaxPagesPerSite", Number(event.target.value))} /></label>
      <label>Fetch timeout (ms)<input type="number" min="2000" max="20000" step="500" value={form.researchFetchTimeoutMs} onChange={(event) => update("researchFetchTimeoutMs", Number(event.target.value))} /></label>
      <label>Max concurrency<input type="number" min="1" max="5" value={form.researchMaxConcurrency} onChange={(event) => update("researchMaxConcurrency", Number(event.target.value))} /></label>
      <label className="wide checkbox-label"><input type="checkbox" checked={form.researchAiAnalysisEnabled} onChange={(event) => update("researchAiAnalysisEnabled", event.target.checked)} /> Enable AI interpretation after deterministic website extraction</label>
    </div>
    <p className="panel-title" style={{ marginTop: 26 }}>Realtime voice</p>
    <div className="settings-grid">
      <label>JARVIS voice<select value={form.jarvisVoice} onChange={(event) => update("jarvisVoice", event.target.value)}><option value="marin">Marin</option><option value="cedar">Cedar</option><option value="coral">Coral</option><option value="alloy">Alloy</option></select></label>
      <label>Interaction mode<select value={form.voiceMode} onChange={(event) => update("voiceMode", event.target.value)}><option value="conversation">Conversation</option><option value="push_to_talk">Push to talk</option></select></label>
    </div>
    {message && <div className="auth-message" role="status">{message}</div>}
    <button className="primary" disabled={busy} style={{ marginTop: 20 }} type="submit">{busy ? "Saving…" : onboarding ? "JARVIS is ready" : "Save business memory"}</button>
  </form>;
}
