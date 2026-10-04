"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadMissionDashboard, type MissionViewState } from "@/lib/missions/client-load";


export function MissionOperations({ initialState }: { initialState: MissionViewState }) {
  const [state, setState] = useState<MissionViewState>(initialState);
  const lastReady = useRef<MissionViewState>(initialState.kind === "ready" ? initialState : { kind: "loading" });
  const inFlight = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [industry, setIndustry] = useState("");
  const [geography, setGeography] = useState("");
  const [goal, setGoal] = useState("");
  const [senderIdentity, setSenderIdentity] = useState("");

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    if (lastReady.current.kind !== "ready") setState({ kind: "loading" });
    setRefreshError("");
    try {
      const result = await loadMissionDashboard(controller.signal, fetch, 20_000);
      if (inFlight.current === controller) {
        if (result.kind === "ready") { lastReady.current = result; setState(result); }
        else if (result.kind === "auth") { lastReady.current = { kind: "loading" }; setState(result); }
        else if (lastReady.current.kind === "ready") { setState(lastReady.current); setRefreshError(result.kind === "error" ? result.message : "Η ανανέωση απέτυχε."); }
        else setState(result);
      }
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);
  useEffect(() => { if (initialState.kind !== "ready") void refresh(); return () => { inFlight.current?.abort(); inFlight.current = null; }; }, [initialState.kind, refresh]);
  const data = state.kind === "ready" ? state.data : null;

  async function createMission(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, industry, geography, goal, senderIdentity, dailyTargetLimit: 20, outreachMode: "APPROVAL_REQUIRED" }) });
      const result = await response.json();
      setMessage(response.ok ? "Η αποστολή αποθηκεύτηκε σε παύση. Ενεργοποιήστε τη όταν είστε έτοιμοι." : result.error ?? "Η αποθήκευση απέτυχε.");
      if (response.ok) { setTitle(""); setIndustry(""); setGeography(""); setGoal(""); setSenderIdentity(""); await refresh(); }
    } finally { setSaving(false); }
  }

  async function setStatus(id: string, status: "active" | "paused" | "stopped") {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/missions/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const result = await response.json();
      setMessage(response.ok ? `Η αποστολή είναι τώρα ${status}.` : result.error ?? "Η αλλαγή απέτυχε.");
      await refresh();
    } finally { setSaving(false); }
  }

  async function requestApproval(id: string) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/missions/outreach/${encodeURIComponent(id)}/request-approval`, { method: "POST" });
      const result = await response.json();
      setMessage(response.ok ? "Η ακριβής πρόταση email βρίσκεται στις Εγκρίσεις. Δεν στάλθηκε τίποτα." : result.error ?? "Η αίτηση έγκρισης απέτυχε.");
      await refresh();
    } finally { setSaving(false); }
  }

  async function setPhoneRule(id: string, priority: "HIGH" | "URGENT", phoneEnabled: boolean) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/missions/${encodeURIComponent(id)}/notification-rules`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priority, phoneEnabled, cooldownMinutes: 120 }) });
      const result = await response.json();
      setMessage(response.ok ? phoneEnabled ? "Ο κανόνας αποθηκεύτηκε. Η κλήση απαιτεί και ενεργό καθολικό τηλεφωνικό policy." : "Οι κλήσεις γι' αυτή την προτεραιότητα απενεργοποιήθηκαν." : result.error ?? "Ο κανόνας δεν αποθηκεύτηκε.");
      await refresh();
    } finally { setSaving(false); }
  }

  return <section className="panel operations-section mission-section" id="missions" aria-label="Daily Missions">
    <div className="operations-section-head"><div><p className="panel-title">DAILY MISSIONS · REAL DATA ONLY</p><h2>Καθημερινές αποστολές</h2><p>Έρευνα, πρόοδος και επόμενες ενέργειες σε ένα σημείο.</p></div><div className="operations-section-actions">{data?.available && <span className="operations-count">{data.missions.length} ΑΠΟΣΤΟΛΕΣ</span>}<button className="secondary" type="button" disabled={saving || state.kind === "loading"} onClick={() => void refresh()}>Ανανέωση</button></div></div>
    {refreshError && <p className="operations-refresh-warning" role="status">Εμφανίζονται τα τελευταία πραγματικά δεδομένα. Η ανανέωση απέτυχε: {refreshError}</p>}
    {state.kind === "loading" ? <p className="operations-state" role="status">Φόρτωση πραγματικών δεδομένων…</p> : state.kind === "auth" ? <p className="operations-state" role="alert">Απαιτείται σύνδεση. <Link href="/auth/sign-in?next=%2Foperations">Σύνδεση</Link></p> : state.kind === "error" ? <p className="operations-state" role="alert">Σφάλμα αποστολών: {state.message} <button className="secondary" onClick={() => void refresh()}>Επανάληψη</button></p> : !data?.available ? <p className="operations-state" role="alert">Η αποθήκευση αποστολών δεν είναι ενεργή: {data?.reason ?? "Άγνωστη αιτία"}. Δεν εμφανίζονται φανταστικά δεδομένα.</p> : <>
      <div className="mission-list">
        {data.missions.length === 0 && <p className="operations-state">Δεν υπάρχουν αποστολές ακόμη. Μια νέα αποστολή ξεκινά πάντα σε παύση.</p>}
        {data.missions.map(({ mission, run, metrics, events, outreach, briefing, nextAction, localDate, notificationRules }) => <article className="mission-card" key={mission.id}>
          <div className="mission-card-top"><div className="mission-identity"><div className="mission-badges"><span className={`operations-status ${mission.status}`}>{mission.status === "active" ? "ΕΝΕΡΓΗ" : mission.status === "paused" ? "ΣΕ ΠΑΥΣΗ" : "ΣΤΑΜΑΤΗΜΕΝΗ"}</span><span className="operations-tag">{mission.outreachPolicy.researchOnly === true ? "ΜΟΝΟ ΕΡΕΥΝΑ" : "ΕΓΚΡΙΣΗ OUTREACH"}</span></div><h3>{mission.title}</h3><p>{mission.industry} <span>·</span> {mission.geography}</p></div><div className="mission-actions">{mission.status === "active" && <button className="secondary" disabled={saving} onClick={() => void setStatus(mission.id, "paused")}>Παύση</button>}{mission.status === "paused" && <button className="secondary" disabled={saving} onClick={() => void setStatus(mission.id, "active")}>Συνέχιση</button>}{mission.status !== "stopped" && <button className="secondary danger" disabled={saving} onClick={() => void setStatus(mission.id, "stopped")}>Διακοπή</button>}<Link className="secondary" href="/leads">Προβολή leads</Link></div></div>
          <p className="mission-goal">{mission.goal}</p>
          <div className="mission-stats" aria-label={`Μετρικές αποστολής για ${localDate}`}><div><b>{metrics.discovered}</b><span>Εντοπίστηκαν σήμερα</span></div><div><b>{metrics.qualified}</b><span>Κατάλληλα leads</span></div>{mission.outreachPolicy.researchOnly !== true && <><div><b>{metrics.outreachDrafts}</b><span>Drafts</span></div><div><b>{metrics.pendingApprovals}</b><span>Προς έγκριση</span></div><div><b>{metrics.outreachSent}</b><span>Απεστάλησαν</span></div></>}</div>
          <div className="mission-timeline"><span><b>Πρόοδος</b>{run?.status ?? "Δεν ξεκίνησε"}</span><span><b>Επόμενο</b>{nextAction}</span><span><b>Ωράριο</b>{mission.workStart.slice(0, 5)}–{mission.workEnd.slice(0, 5)}</span><span><b>Briefing</b>{mission.briefingTime.slice(0, 5)}</span></div>
          <p className="mission-last-activity">Ημερομηνία {localDate} · Έναρξη {run?.started_at ? new Date(run.started_at).toLocaleString("el-GR") : "—"} · Τελευταία δραστηριότητα {events[0] ? new Date(events[0].created_at).toLocaleString("el-GR") : "—"}</p>
          {mission.outreachPolicy.researchOnly === true && <p className="mission-safety">Μόνο έρευνα — χωρίς outreach, email ή τηλεφωνικές ειδοποιήσεις.</p>}
          {run?.last_error_category && <p className="mission-alert" role="alert">Εμπόδιο: {run.last_error_category}</p>}
          {briefing && <div className="mission-briefing"><b>Τελευταίο briefing</b><p>{briefing.summary}</p></div>}
          <div className="mission-accordions"><details><summary>Συμβάντα αποστολής <small>{events.length}</small></summary><div className="mission-detail-content">{events.length ? events.map((item) => <p key={item.id}>{new Date(item.created_at).toLocaleString("el-GR")} · {item.priority} · {item.event_type} · τηλέφωνο: {item.phone_dispatch_status}</p>) : <p>Κανένα συμβάν.</p>}</div></details>
          {mission.outreachPolicy.researchOnly !== true && <details><summary>Outreach drafts <small>{outreach.length}</small></summary><div className="mission-detail-content">{outreach.length ? outreach.map((item) => <article className="mission-draft" key={item.id}><b>{item.status.toUpperCase()} · {item.subject}</b><small>{item.recipient_email}</small><p>{item.body}</p>{item.status === "draft" && <button className="secondary" disabled={saving} onClick={() => void requestApproval(item.id)}>Ζήτηση έγκρισης</button>}</article>) : <p>Κανένα draft.</p>}</div></details>}
          {mission.outreachPolicy.researchOnly !== true && <details><summary>Ειδοποιήσεις αποστολής</summary><div className="mission-detail-content">{!data.phoneNotificationsEnabled && <p>Οι αυτόματες τηλεφωνικές ειδοποιήσεις δεν έχουν ενεργοποιηθεί στην εγκατάσταση. Η ρύθμιση κανόνα από μόνη της δεν ξεκινά κλήση.</p>}{(["HIGH", "URGENT"] as const).map((priority) => { const rule = notificationRules.find((item) => item.priority === priority); const enabled = Boolean(rule?.phone_enabled); return <div className="mission-rule" key={priority}><span><b>{priority}</b> · {enabled ? "τηλέφωνο επιλεγμένο" : "μόνο dashboard"} · cooldown {rule?.cooldown_minutes ?? 120}′</span><button className="secondary" disabled={saving || mission.status === "stopped"} onClick={() => void setPhoneRule(mission.id, priority, !enabled)}>{enabled ? "Απενεργοποίηση τηλεφώνου" : "Επιλογή τηλεφώνου"}</button></div>; })}</div></details>}</div>
        </article>)}
      </div>
      <form className="mission-create" onSubmit={(event) => void createMission(event)}><div className="mission-create-head"><p className="panel-title">NEW MISSION</p><h3>Νέα αποστολή</h3><p>Ορίστε έναν σαφή στόχο. Η αποστολή αποθηκεύεται πρώτα σε παύση.</p></div><div className="mission-form-grid"><label className="wide">Τίτλος<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={200} placeholder="π.χ. Δερματολογικά ιατρεία — Έρευνα" required /></label><label>Κλάδος<input value={industry} onChange={(event) => setIndustry(event.target.value)} minLength={2} maxLength={160} placeholder="π.χ. Δερματολογία" required /></label><label>Περιοχή<input value={geography} onChange={(event) => setGeography(event.target.value)} minLength={2} maxLength={160} placeholder="π.χ. Ελλάδα" required /></label><label className="wide">Στόχος<textarea value={goal} onChange={(event) => setGoal(event.target.value)} minLength={3} maxLength={1000} rows={3} placeholder="Περιγράψτε τι πρέπει να ερευνήσει και πώς θα επιλέξει τα κατάλληλα leads" required /></label><label className="wide">Υπογραφή για drafts <small>Προαιρετικά</small><input value={senderIdentity} onChange={(event) => setSenderIdentity(event.target.value)} maxLength={160} placeholder="Όνομα ή επαγγελματική υπογραφή" /></label></div><div className="mission-create-footer"><p>20 υποψήφιοι/ημέρα · 09:00–20:30 · outreach μόνο με έγκριση. Δεν αποστέλλεται email ή κλήση με τη δημιουργία.</p><button className="primary" type="submit" disabled={saving}>Αποθήκευση σε παύση</button></div></form>
    </>}
    {message && <p className="operations-feedback" role="status">{message}</p>}
  </section>;
}
