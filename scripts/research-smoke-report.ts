import { loadEnvConfig } from "@next/env";
import { createAdminClient } from "../lib/supabase/admin";

loadEnvConfig(process.cwd());

async function main() {
  const runId = process.argv[2];
  if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("A research run ID is required.");
  const db = createAdminClient();
  const run = await db.from("research_runs").select("id,user_id,status,created_at,config_json").eq("id", runId).single();
  if (run.error || !run.data) throw new Error("Research run could not be read.");
  const [candidates, sources, leads, jobs, runtime, settings] = await Promise.all([
    db.from("research_candidates").select("id,business_name,status,lead_id").eq("research_run_id", runId),
    db.from("research_sources").select("candidate_id,metadata_json,source_url").eq("research_run_id", runId),
    db.from("leads").select("id,status,score,score_reason,opportunity_summary").eq("user_id", run.data.user_id).gte("created_at", run.data.created_at),
    db.from("background_jobs").select("id,job_type,status").eq("user_id", run.data.user_id).in("status", ["pending", "scheduled", "running", "retrying"]),
    db.from("operation_runtime").select("runtime_type,last_seen_at").in("runtime_type", ["worker", "scheduler"]),
    db.from("settings").select("research_max_leads").eq("user_id", run.data.user_id).maybeSingle(),
  ]);
  if (candidates.error || sources.error || leads.error || jobs.error || runtime.error || settings.error) throw new Error("Remote smoke report query failed.");
  const leadById = new Map((leads.data ?? []).map((lead) => [lead.id, lead]));
  const candidateReport = (candidates.data ?? []).map((candidate) => {
    const candidateSources = (sources.data ?? []).filter((source) => source.candidate_id === candidate.id);
    const verification = candidateSources.find((source) => typeof source.metadata_json?.websiteStatus === "string");
    return {
      name: candidate.business_name,
      status: candidate.status,
      websiteStatus: verification?.metadata_json?.websiteStatus ?? "UNRESEARCHED",
      sourceCount: candidateSources.length,
      score: candidate.lead_id ? leadById.get(candidate.lead_id)?.score ?? null : null,
      scoreReason: candidate.lead_id ? leadById.get(candidate.lead_id)?.score_reason ?? null : null,
      testMarked: candidate.lead_id ? String(leadById.get(candidate.lead_id)?.opportunity_summary ?? "").startsWith("[TEST RESEARCH]") : candidateSources.some((source) => source.metadata_json?.testOnly === true),
    };
  });
  const liveSince = Date.now() - 3 * 60_000;
  console.log(JSON.stringify({ runStatus: run.data.status, candidates: candidateReport, pendingResearchJobs: (jobs.data ?? []).filter((job) => job.job_type === "research_continue").length, queuedPhoneJobs: (jobs.data ?? []).filter((job) => job.job_type === "outbound_jarvis_call").length, workerConnected: (runtime.data ?? []).some((entry) => entry.runtime_type === "worker" && Date.parse(entry.last_seen_at) >= liveSince), schedulerConnected: (runtime.data ?? []).some((entry) => entry.runtime_type === "scheduler" && Date.parse(entry.last_seen_at) >= liveSince), ownerResearchMaxLeads: settings.data?.research_max_leads ?? null }));
}

void main().catch((error) => { console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "Unknown error" })); process.exitCode = 1; });
