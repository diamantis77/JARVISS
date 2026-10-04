import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { OperationsDashboard } from "@/components/operations-dashboard";
import { TelephonyOperations } from "@/components/telephony-operations";
import { MissionOperations } from "@/components/mission-operations";
import { ResearchOperations } from "@/components/research-operations";
import { AiProvidersOperations } from "@/components/ai-providers-operations";
import { aiProviderSnapshot } from "@/lib/ai/router-metrics";
import type { MissionViewState } from "@/lib/missions/client-load";
import { readMissionDashboard } from "@/lib/missions/dashboard";
import { createClient } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n";
export const dynamic = "force-dynamic";
export default async function OperationsPage() {
  const context = await createRequestRepositories();
  if (!context) redirect("/auth/sign-in");
  const snapshot = await context.repositories.operations.snapshot();
  const researchRuns = await context.repositories.research.listRecent(10);
  let missionState: MissionViewState = { kind: "auth" };
  if (context.mode === "live") {
    const supabase = await createClient();
    if (supabase) {
      try {
        missionState = { kind: "ready", data: await readMissionDashboard(supabase, context.userId) };
      } catch {
        missionState = { kind: "error", message: "Αδυναμία ανάγνωσης των αποστολών από το Supabase." };
      }
    }
  }
  return <main className="page operations-page">
    <Link href="/" className="operations-back"><ArrowLeft size={14} /> {tr("Command center")}</Link>
    <header className="operations-page-head"><div><p className="operations-eyebrow">JARVIS / OPERATIONS</p><h1>{tr("System / Operations")}</h1><p>{tr("Durable jobs, provider health and actionable failures.")}</p></div><span className={`operations-mode ${context.mode}`}>{context.mode === "live" ? "LIVE DATA" : "DEMO DATA"}</span></header>
    <OperationsDashboard initial={snapshot} mode={context.mode} />
    <AiProvidersOperations initial={aiProviderSnapshot()} />
    {context.mode === "live" && <MissionOperations initialState={missionState} />}
    {context.mode === "live" && <ResearchOperations initial={researchRuns} />}
    {context.mode === "live" && <TelephonyOperations />}
  </main>;
}
