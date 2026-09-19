import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/settings-form";
import { createRequestRepositories } from "@/lib/repositories/factory";

export const dynamic = "force-dynamic";
export default async function OnboardingPage() { const context = await createRequestRepositories(); if (!context) redirect("/auth/sign-in"); const settings = await context.repositories.settings.get(); return <main className="page"><SettingsForm initial={settings} mode={context.mode} onboarding /></main>; }
