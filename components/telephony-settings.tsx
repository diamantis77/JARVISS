"use client";

import { useEffect, useState } from "react";
import type { PhoneCall, PhoneNotificationSettings, TelephonyStatus } from "@/types";
import { DEFAULT_PHONE_SETTINGS } from "@/lib/telephony/policy";
import { formatDateTime } from "@/lib/i18n";

type Snapshot = { status: TelephonyStatus; settings: PhoneNotificationSettings; calls: PhoneCall[] };

export function TelephonySettings() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState(DEFAULT_PHONE_SETTINGS);
  const [reason, setReason] = useState("Σύντομη ενημέρωση από τον JARVIS");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/telephony/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      if (data.status) setSnapshot({ status: data.status, settings: DEFAULT_PHONE_SETTINGS, calls: [] });
      setMessage(data.error ?? "Η τηλεφωνία δεν είναι ακόμη έτοιμη."); return;
    }
    setSnapshot(data); setSettings(data.settings);
  }
  useEffect(() => { void refresh(); }, []);

  async function save() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/telephony/status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    const data = await response.json();
    setBusy(false); setMessage(response.ok ? "Οι ασφαλείς ρυθμίσεις τηλεφωνίας αποθηκεύτηκαν." : data.error);
    if (response.ok) void refresh();
  }

  async function callOwner() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/telephony/calls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, urgent: false, context: { source: "settings_manual_test" } }) });
    const data = await response.json();
    setBusy(false); setMessage(response.ok ? "Η κλήση μπήκε με ασφάλεια στην ουρά." : data.error);
    if (response.ok) void refresh();
  }

  const update = <K extends keyof PhoneNotificationSettings>(key: K, value: PhoneNotificationSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const readiness = snapshot?.status.readiness ?? "not_configured";

  return <section className="panel detail-block settings-form" style={{ marginTop: 18 }}>
    <p className="panel-title">JARVIS PHONE · {readiness.replaceAll("_", " ").toUpperCase()}</p>
    <h2>Τηλεφωνική ενημέρωση ιδιοκτήτη</h2>
    <p className="subtitle">Outbound μόνο προς τον αποθηκευμένο αριθμό ιδιοκτήτη. Ο αριθμός και τα credentials δεν εμφανίζονται ποτέ στο UI.</p>
    <div className="settings-grid">
      <label className="wide checkbox-label"><input type="checkbox" checked={settings.enabled} onChange={(event) => update("enabled", event.target.checked)} /> Επιτρέπονται τηλεφωνικές ειδοποιήσεις</label>
      <label>Από<input type="time" value={settings.allowedStart.slice(0, 5)} onChange={(event) => update("allowedStart", `${event.target.value}:00`)} /></label>
      <label>Έως<input type="time" value={settings.allowedEnd.slice(0, 5)} onChange={(event) => update("allowedEnd", `${event.target.value}:00`)} /></label>
      <label>Εκτός ωραρίου<select value={settings.outsideHours} onChange={(event) => update("outsideHours", event.target.value as PhoneNotificationSettings["outsideHours"])}><option value="never">Ποτέ</option><option value="urgent_only">Μόνο επείγον</option></select></label>
      <label className="wide checkbox-label"><input type="checkbox" checked={settings.customerReplyOutsideHours} onChange={(event) => update("customerReplyOutsideHours", event.target.checked)} /> Κάλεσέ με και εκτός ωραρίου για επιβεβαιωμένη απάντηση πελάτη σε email του JARVIS</label>
      <p className="wide settings-note">Για να ισχύσει, ενεργοποίησε και τις «Τηλεφωνικές ειδοποιήσεις» και τη «Σημαντική απάντηση πελάτη». Δεν αλλάζει το ωράριο ή τους άλλους τύπους κλήσεων.</p>
      <label>Μέγιστη διάρκεια<input type="number" min="1" max="20" value={settings.maxCallMinutes} onChange={(event) => update("maxCallMinutes", Number(event.target.value))} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={settings.morningBrief} onChange={(event) => update("morningBrief", event.target.checked)} /> Πρωινό brief</label>
      <label className="checkbox-label"><input type="checkbox" checked={settings.hotLeadReply} onChange={(event) => update("hotLeadReply", event.target.checked)} /> Hot lead reply</label>
      <label className="checkbox-label"><input type="checkbox" checked={settings.importantCustomerReply} onChange={(event) => update("importantCustomerReply", event.target.checked)} /> Σημαντική απάντηση πελάτη</label>
      <label className="checkbox-label"><input type="checkbox" checked={settings.meetingSoon} onChange={(event) => update("meetingSoon", event.target.checked)} /> Συνάντηση σύντομα</label>
      <label className="checkbox-label"><input type="checkbox" checked={settings.criticalProviderFailure} onChange={(event) => update("criticalProviderFailure", event.target.checked)} /> Κρίσιμο provider failure</label>
      <label className="checkbox-label"><input type="checkbox" checked={settings.highValueDeal} onChange={(event) => update("highValueDeal", event.target.checked)} /> High-value deal</label>
      <label className="checkbox-label"><input type="checkbox" checked={settings.customPriorityEvent} onChange={(event) => update("customPriorityEvent", event.target.checked)} /> Custom priority event</label>
    </div>
    <div className="button-row" style={{ marginTop: 18 }}><button className="primary" type="button" disabled={busy} onClick={() => void save()}>Αποθήκευση phone policy</button></div>
    <div className="settings-grid" style={{ marginTop: 22 }}>
      <label className="wide">Αιτία δοκιμαστικής κλήσης<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>
    </div>
    <button className="secondary" type="button" disabled={busy || readiness !== "ready" || !settings.enabled} onClick={() => void callOwner()}>Κάλεσέ με τώρα</button>
    {readiness !== "ready" && <p className="settings-note">{readiness === "public_endpoint_missing" ? "TELEPHONY NOT EXTERNALLY REACHABLE · λείπει έγκυρο δημόσιο HTTPS/WSS endpoint." : "Δεν θα γίνει κλήση: ο επιλεγμένος provider ή ο αριθμός ιδιοκτήτη δεν είναι έτοιμος."}</p>}
    {snapshot?.status && <p className="settings-note">Provider: {snapshot.status.provider.toUpperCase()} · From: {snapshot.status.maskedProviderNumber ?? "not configured"} · Owner: {snapshot.status.maskedOwnerNumber ?? "not configured"} · Application: {snapshot.status.applicationConfigured ? "configured" : "missing"} · Public endpoint: {snapshot.status.publicEndpointConfigured ? "configured" : "missing"} · OpenAI bridge: {snapshot.status.openAiBridgeConfigured ? "configured" : "missing"}</p>}
    {message && <div className="auth-message" role="status">{message}</div>}
    {snapshot?.calls?.length ? <div style={{ marginTop: 22 }}><p className="panel-title">Πρόσφατες κλήσεις</p>{snapshot.calls.slice(0, 5).map((call) => <p key={call.id}>{formatDateTime(call.createdAt)} · {call.provider.toUpperCase()} · {call.status.replaceAll("_", " ")} · {call.durationSeconds ?? 0}s · {call.reason}</p>)}</div> : null}
  </section>;
}
