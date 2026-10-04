"use client";

import { useState } from "react";
import type { aiProviderSnapshot } from "@/lib/ai/router-metrics";

type ProviderHealth = ReturnType<typeof aiProviderSnapshot>[number];
const date = (value: string | null) => value ? new Date(value).toLocaleString("el-GR", { timeZone: "Europe/Athens" }) : "—";

export function AiProvidersOperations({ initial }: { initial: ProviderHealth[] }) {
  const [providers, setProviders] = useState(initial);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      const response = await fetch("/api/operations/ai-providers", { cache: "no-store" });
      if (!response.ok) throw new Error("Αδυναμία ανανέωσης AI providers.");
      const result = await response.json() as { providers: ProviderHealth[] };
      setProviders(result.providers); setError("");
    } catch { setError("Αδυναμία ανανέωσης AI providers."); }
  }
  return <section className="panel operations-section ai-providers-section" id="ai-providers">
    <div className="operations-section-head"><div><p className="panel-title">AI ROUTER · SERVER ONLY</p><h2>AI Providers</h2><p>Προτεραιότητα στους διαθέσιμους free-tier providers. OpenAI μόνο ως επιτρεπόμενο fallback.</p></div><button className="secondary" type="button" onClick={() => void refresh()}>Ανανέωση</button></div>
    {error && <p className="operations-refresh-warning">{error}</p>}
    <div className="ai-provider-grid">{providers.map((item) => <article key={item.provider} className="ai-provider-card">
      <div className="ai-provider-head"><b>{item.provider === "openrouter" ? "OpenRouter Free" : item.provider === "openai" ? "OpenAI · paid fallback" : item.provider}</b><span className={`operations-status ${!item.enabled || !item.configured ? "paused" : item.healthy ? "healthy" : "degraded"}`}>{!item.enabled ? "Disabled" : !item.configured ? "Not configured" : item.cooldownUntil ? "Cooldown" : item.healthy ? "Ready / unverified" : "Degraded"}</span></div>
      <p className="ai-provider-model">{item.model}</p>
      <dl><div><dt>Configured</dt><dd>{item.configured ? "Yes" : "No"}</dd></div><div><dt>Enabled</dt><dd>{item.enabled ? "Yes" : "No"}</dd></div><div><dt>Requests today</dt><dd>{item.requestsToday}</dd></div><div><dt>Success</dt><dd>{item.successfulRequests}</dd></div><div><dt>Errors</dt><dd>{item.errors}</dd></div><div><dt>Rate limits</dt><dd>{item.rateLimitHits}</dd></div><div><dt>Timeouts</dt><dd>{item.timeouts}</dd></div><div><dt>Fallbacks</dt><dd>{item.fallbacks}</dd></div><div><dt>Avg latency</dt><dd>{item.averageLatencyMs === null ? "—" : `${item.averageLatencyMs} ms`}</dd></div><div><dt>Last success</dt><dd>{date(item.lastSuccess)}</dd></div><div><dt>Last error</dt><dd>{item.lastError ?? "—"}</dd></div><div><dt>Last failure</dt><dd>{date(item.lastFailure)}</dd></div></dl>
    </article>)}</div><p className="ai-provider-note">Μετρήσεις μόνο της τρέχουσας διεργασίας εφαρμογής· μηδενίζονται με restart. «Ready / unverified» σημαίνει ότι υπάρχει ρύθμιση, όχι ότι έγιναν live API calls.</p>
  </section>;
}
