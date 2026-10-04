import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SettingsForm } from "@/components/settings-form";
import { TelephonySettings } from "@/components/telephony-settings";
import { GoogleIntegration } from "@/components/google-integration";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { tr } from "@/lib/i18n";
import { getBrowserLiveVoice } from "@/lib/voice/browser-voice-config";

export const dynamic = "force-dynamic";
const googleMessages: Record<string, string> = {
  "invalid-redirect": "Η επιστροφή από τη Google δεν ταίριαξε με τη ρυθμισμένη τοπική διεύθυνση. Η σύνδεση δεν αποθηκεύτηκε.",
  "invalid-state": "Η συνεδρία σύνδεσης Google έληξε ή δεν επαληθεύτηκε. Δοκίμασε ξανά από τις Ρυθμίσεις.",
  "session-expired": "Η σύνδεση JARVIS έληξε πριν ολοκληρωθεί η σύνδεση Google. Συνδέσου ξανά και δοκίμασε πάλι.",
  denied: "Η πρόσβαση Google δεν εγκρίθηκε. Δεν έγινε σύνδεση.",
  "insufficient-scope": "Δεν δόθηκαν τα απαιτούμενα δικαιώματα Gmail. Δεν έγινε σύνδεση.",
  "missing-refresh-token": "Η Google δεν επέστρεψε διαρκή άδεια πρόσβασης. Δοκίμασε ξανά τη σύνδεση.",
  failed: "Η σύνδεση Google δεν ολοκληρώθηκε. Δεν αποθηκεύτηκε λογαριασμός.",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  const context = await createRequestRepositories(); if (!context) redirect("/auth/sign-in");
  const [settings, connection, health] = await Promise.all([context.repositories.settings.get(), context.repositories.connections.getGoogle().catch(() => null), context.repositories.connections.listHealth().catch(() => [])]);
  const publicConnection = connection ? { id: connection.id, providerEmail: connection.providerEmail, status: connection.status, scopes: connection.scopes, connectedAt: connection.connectedAt, lastSyncAt: connection.lastSyncAt, errorMessage: connection.errorMessage, refreshTokenPresent: Boolean(connection.refreshTokenEncrypted), tokenExpiresAt: connection.tokenExpiresAt } : null;
  const googleMessage = google === "connected" ? connection?.status === "connected" ? "Το Google Workspace συνδέθηκε επιτυχώς." : "Η Google επέστρεψε, αλλά η σύνδεση δεν αποθηκεύτηκε. Δοκίμασε ξανά." : google ? googleMessages[google] : null;
  return <main className="page"><Link href="/" className="subtitle"><ArrowLeft size={13} /> {tr("Command center")}</Link><div className="page-head"><div><h1>{tr("Settings")}</h1><p className="subtitle">{tr("Persistent business context and operating preferences.")}</p></div><Link href="/operations" className="secondary">{tr("System / Operations")}</Link></div>{googleMessage && <p className="auth-message" role="status">{googleMessage}</p>}<SettingsForm initial={settings} mode={context.mode} browserVoice={getBrowserLiveVoice()} />{context.mode === "live" && <TelephonySettings />}<GoogleIntegration connection={publicConnection} mode={context.mode} health={health} /><section className="panel detail-block" style={{ marginTop: 18, maxWidth: 840 }}><p className="panel-title">{tr("Provider status")}</p><p>{tr(context.mode === "demo" ? "Supabase is not configured. Fictional seeded records are active and no external actions can occur." : "Supabase persistence is active. Google capabilities are granted incrementally.")}</p><p>{tr("Every external or sensitive action remains subject to the authoritative application approval gate.")}</p></section></main>;
}
