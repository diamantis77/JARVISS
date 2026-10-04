"use client";

import { useEffect, useState } from "react";
import type { PhoneCall, TelephonyStatus } from "@/types";
import { formatDateTime } from "@/lib/i18n";

export function TelephonyOperations() {
  const [status, setStatus] = useState<TelephonyStatus | null>(null);
  const [calls, setCalls] = useState<PhoneCall[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/telephony/status", { cache: "no-store" }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setStatus(data.status); setCalls(data.calls ?? []); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Telephony status unavailable")); }, []);
  return <section className="panel operations-section telephony-section" id="telephony">
    <div className="operations-section-head"><div><p className="panel-title">PROVIDER HEALTH · TELEPHONY</p><h2>Τηλεφωνική σύνδεση</h2><p>Τρέχουσα διαμόρφωση και πρόσφατες κλήσεις.</p></div><span className={`operations-status ${status?.health ?? "checking"}`}>{status?.health.replaceAll("_", " ").toUpperCase() ?? "CHECKING"}</span></div>
    <div className="telephony-facts"><div><small>PROVIDER</small><b>{status?.provider.toUpperCase() ?? "—"}</b></div><div><small>CREDENTIALS</small><b>{status?.credentialsConfigured ? "Detected" : "Missing"}</b></div><div><small>APPLICATION</small><b>{status?.applicationConfigured ? "Configured" : "Missing"}</b></div><div><small>PUBLIC HTTPS/WSS</small><b>{status?.publicEndpointConfigured ? "Configured" : "Missing"}</b></div><div><small>OPENAI BRIDGE</small><b>{status?.openAiBridgeConfigured ? "Configured" : "Missing"}</b></div></div>
    {error && <p className="mission-alert" role="alert">{error}</p>}
    {calls.length > 0 && <div className="telephony-calls"><h3>Πρόσφατες κλήσεις</h3>{calls.slice(0, 5).map((call) => <div className="job-row" key={call.id}><div><b>{call.provider.toUpperCase()} · {call.status.replaceAll("_", " ")}</b><span>{formatDateTime(call.createdAt)} · κλήση {call.durationSeconds ?? 0}s · Live {call.liveSessionDurationSeconds ?? 0}s · {call.reason}</span>{call.errorSummary && <span>{call.errorSummary}</span>}</div></div>)}</div>}
  </section>;
}
