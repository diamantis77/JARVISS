"use client";

import { useState } from "react";
import type { ProviderConnection, ProviderHealth } from "@/types";
import { hasCapability } from "@/lib/google/scopes";

type PublicConnection = Pick<ProviderConnection, "id" | "providerEmail" | "status" | "scopes" | "connectedAt" | "lastSyncAt" | "errorMessage" | "tokenExpiresAt"> & { refreshTokenPresent: boolean };

export function GoogleIntegration({ connection, mode, health }: { connection: PublicConnection | null; mode: "demo" | "live"; health: ProviderHealth[] }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const gmail = Boolean(connection && connection.status === "connected" && hasCapability(connection.scopes, "gmail") && connection.refreshTokenPresent);
  const calendar = Boolean(connection && connection.status === "connected" && hasCapability(connection.scopes, "calendar") && connection.refreshTokenPresent);
  const gmailHealth = health.find((item) => item.capability === "gmail");
  const calendarHealth = health.find((item) => item.capability === "calendar");

  async function post(url: string, body: Record<string, unknown>, success: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error);
    } catch { setMessage("Η δοκιμή δεν ολοκληρώθηκε. Έλεγξε τη σύνδεση."); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Google? Stored OAuth tokens will be revoked/deleted; CRM history will be retained.")) return;
    setBusy(true);
    try { const response = await fetch("/api/integrations/google", { method: "DELETE" }); setMessage(response.ok ? "Google disconnected. Refresh this page to update status." : "Disconnect failed."); }
    catch { setMessage("Disconnect failed."); }
    finally { setBusy(false); }
  }

  return <section className="panel detail-block integration-card">
    <p className="panel-title">Google Workspace</p>
    <div className="integration-status"><div><b>{connection?.providerEmail ?? "No account connected"}</b><p>{mode === "demo" ? "DEMO · fictional email, calendar and notifications only" : connection ? `${connection.status} · Last sync ${connection.lastSyncAt ?? "never"}` : "Connect each capability only when you need it."}</p></div>{connection && <span className="pill">{connection.status}</span>}</div>
    <div className="integration-grid">
      <div><strong>Gmail</strong><p>{gmail ? `CONNECTED · ${gmailHealth?.status ?? "health pending"}` : "DISCONNECTED"}</p><p>Last sync: {gmailHealth?.lastSyncAt ?? "never"}<br />Watch: {gmailHealth?.watchExpiration ?? "not active"}</p>{mode === "live" && (gmail ? <button className="secondary" disabled={busy} onClick={() => void post("/api/integrations/google/sync", { capability: "gmail" }, "Gmail sync queued.")}>Run Gmail Sync</button> : <a className="primary" href="/api/integrations/google/connect?capability=gmail">Connect Gmail</a>)}</div>
      <div><strong>Calendar</strong><p>{calendar ? `Connected · ${calendarHealth?.status ?? "health pending"}` : "Disconnected"}</p><p>Last sync: {calendarHealth?.lastSyncAt ?? "never"}<br />Watch: {calendarHealth?.watchExpiration ?? "not active"}</p>{mode === "live" && (calendar ? <button className="secondary" disabled={busy} onClick={() => void post("/api/integrations/google/sync", { capability: "calendar" }, "Calendar sync queued.")}>Run Calendar Sync</button> : <a className="primary" href="/api/integrations/google/connect?capability=calendar">Connect Calendar</a>)}</div>
    </div>
    <div className="diagnostic-actions"><button className="secondary" disabled={busy || !gmail} onClick={() => void post("/api/integrations/google/diagnostics", { action: "test_gmail" }, "Gmail read diagnostic passed.")}>Test Gmail Connection</button><button className="secondary" disabled={busy || !calendar} onClick={() => void post("/api/integrations/google/diagnostics", { action: "test_calendar" }, "Calendar read diagnostic passed.")}>Test Calendar Connection</button><button className="secondary" disabled={busy} onClick={() => void post("/api/integrations/google/diagnostics", { action: "test_notification" }, "Test Notification created.")}>Test Notification</button></div>
    {connection && <details><summary>OAuth diagnostics</summary><ul><li>OAuth: {connection.status}</li><li>Gmail read: {connection.scopes.includes("https://www.googleapis.com/auth/gmail.readonly") ? "granted" : "not granted"}</li><li>Gmail drafts/send: {connection.scopes.includes("https://www.googleapis.com/auth/gmail.compose") ? "granted" : "not granted"}</li><li>Refresh token: {connection.refreshTokenPresent ? "present (encrypted server-side)" : "missing — reconnect required"}</li><li>Access token expiry: {connection.tokenExpiresAt ?? "not reported"}</li></ul></details>}
    {connection?.errorMessage && <div className="auth-message auth-error">{connection.errorMessage}</div>}
    {message && <div className="auth-message" role="status">{message}</div>}
    {connection && mode === "live" && <button className="secondary danger" disabled={busy} onClick={() => void disconnect()}>Disconnect Google</button>}
  </section>;
}
