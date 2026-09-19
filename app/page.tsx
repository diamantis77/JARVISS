import { redirect } from "next/navigation";
import { CommandCenter } from "@/components/command-center";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { isOpenAiConfigured } from "@/lib/config/runtime";
import type { JarvisRun } from "@/types";

const emptyRun: JarvisRun = { id: "idle", request: "", status: "pending", summary: "JARVIS is ready for your first command.", currentStep: 0, createdAt: "", steps: [] };

export const dynamic = "force-dynamic";
export default async function HomePage({ searchParams }: { searchParams: Promise<{ command?: string }> }) {
  const context = await createRequestRepositories(); if (!context) redirect("/auth/sign-in");
  const [leads, activities, tasks, approvals, runs] = await Promise.all([context.repositories.leads.list(), context.repositories.activity.list(8), context.repositories.tasks.list(), context.repositories.approvals.getPending(), context.repositories.runs.listRecentRuns(1)]);
  const initialRun = runs[0] ? (await context.repositories.runs.getRun(runs[0].id)) ?? runs[0] : emptyRun;
  return <CommandCenter mode={context.mode} aiMode={context.mode === "live" && isOpenAiConfigured() ? "openai" : "demo"} leads={leads} activities={activities} tasks={tasks} approvals={approvals} initialRun={initialRun} initialCommand={(await searchParams).command?.slice(0, 1000)} />;
}
