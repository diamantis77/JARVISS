import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SettingsForm } from "@/components/settings-form";
import { GoogleIntegration } from "@/components/google-integration";
import { createRequestRepositories } from "@/lib/repositories/factory";

export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  const context = await createRequestRepositories(); if (!context) redirect("/auth/sign-in");
  const [settings, connection] = await Promise.all([context.repositories.settings.get(), context.repositories.connections.getGoogle()]);
  const publicConnection = connection ? { id: connection.id, providerEmail: connection.providerEmail, status: connection.status, scopes: connection.scopes, connectedAt: connection.connectedAt, lastSyncAt: connection.lastSyncAt, errorMessage: connection.errorMessage } : null;
  return <main className="page"><Link href="/" className="subtitle"><ArrowLeft size={13} /> Command center</Link><div className="page-head"><div><h1>Settings</h1><p className="subtitle">Persistent business context and operating preferences.</p></div></div><SettingsForm initial={settings} mode={context.mode} /><GoogleIntegration connection={publicConnection} mode={context.mode} /><section className="panel detail-block" style={{ marginTop: 18, maxWidth: 840 }}><p className="panel-title">Provider status</p><p>{context.mode === "demo" ? "Supabase is not configured. Fictional seeded records are active and no external actions can occur." : "Supabase persistence is active. Google capabilities are granted incrementally."}</p><p>Every external or sensitive action remains subject to the authoritative application approval gate.</p></section></main>;
}
