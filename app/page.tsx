import { redirect } from "next/navigation";
import { CommandCenter } from "@/components/command-center";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { getResearchMode, isVoiceEnabled } from "@/lib/config/runtime";
import { hasAnyAiProvider } from "@/lib/ai/routing-config";
import type { JarvisRun } from "@/types";
import { aggregateBriefing } from "@/lib/briefing";
import type { WeatherSnapshot } from "@/lib/weather/contracts";

const emptyRun: JarvisRun = { id: "idle", request: "", status: "pending", summary: "Ο JARVIS είναι έτοιμος για την πρώτη σας εντολή.", currentStep: 0, createdAt: "", steps: [] };

export const dynamic = "force-dynamic";
export default async function HomePage({ searchParams }: { searchParams: Promise<{ command?: string }> }) {
  const context = await createRequestRepositories(); if (!context) redirect("/auth/sign-in");
  const [leads, activities, tasks, approvals, runs, notifications, settings, googleConnection] = await Promise.all([context.repositories.leads.list(), context.repositories.activity.list(100), context.repositories.tasks.list(), context.repositories.approvals.getPending(), context.repositories.runs.listRecentRuns(20), context.repositories.notifications.list(100), context.repositories.settings.get(), context.repositories.connections.getGoogle().catch(() => null)]);
  const weather: WeatherSnapshot = { status: "unavailable", location: null, reason: "missing_location" };
  const briefing = aggregateBriefing({ now: new Date(), timezone: settings.timezone, leads, activities, tasks, approvals, notifications, runs, weather });
  const initialRun = runs[0] ? (await context.repositories.runs.getRun(runs[0].id)) ?? runs[0] : emptyRun;
  const scopes = googleConnection?.scopes ?? [];
  return <CommandCenter mode={context.mode} aiMode={context.mode === "demo" ? "demo" : hasAnyAiProvider() ? "routed" : "unavailable"} researchMode={getResearchMode(context.mode)} voiceEnabled={isVoiceEnabled(context.mode)} voiceSettings={{ wakeModeEnabled: settings.wakeModeEnabled, wakePhrase: settings.wakePhrase, wakeSoundEnabled: settings.wakeSoundEnabled, preferredFormOfAddress: settings.preferredFormOfAddress, timezone: settings.timezone, defaultLanguage: settings.defaultLanguage, microphoneDeviceId: settings.voiceMicrophoneDeviceId }} providerStatus={{ googleConnected: googleConnection?.status === "connected", gmailConnected: googleConnection?.status === "connected" && scopes.some((scope) => scope.includes("gmail")), calendarConnected: googleConnection?.status === "connected" && scopes.some((scope) => scope.includes("calendar")) }} weather={weather} briefing={briefing} leads={leads} activities={activities} tasks={tasks} approvals={approvals} notifications={notifications} initialRun={initialRun} initialCommand={(await searchParams).command?.slice(0, 1000)} />;
}
