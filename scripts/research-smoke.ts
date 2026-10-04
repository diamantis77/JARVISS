import { loadEnvConfig } from "@next/env";
import { createAdminClient } from "../lib/supabase/admin";
import { createSupabaseRepositories } from "../lib/repositories/supabase";
import { LeadResearchService } from "../lib/research/service";
import { OpenAIWebResearchProvider } from "../lib/research/openai-web-provider";
import { SecureWebsiteFetcher } from "../lib/research/website-fetcher";
import { DeterministicWebsiteAnalyzer } from "../lib/research/website-analyzer";

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.JARVIS_RESEARCH_SMOKE !== "1") throw new Error("Set JARVIS_RESEARCH_SMOKE=1 for the bounded research test.");
  if (process.env.LIVE_RESEARCH_ENABLED !== "true" || !process.env.OPENAI_API_KEY) throw new Error("Live research provider is not configured.");
  const db = createAdminClient();
  const owners = await db.from("settings").select("user_id").limit(3);
  if (owners.error || !owners.data || owners.data.length !== 1) throw new Error("The owner cannot be selected unambiguously; no research started.");
  const ownerId = owners.data[0].user_id as string;
  const repositories = createSupabaseRepositories(db, ownerId);
  const provider = new OpenAIWebResearchProvider();
  const service = new LeadResearchService(repositories, provider, provider, new SecureWebsiteFetcher(), new DeterministicWebsiteAnalyzer(), "live");
  let result = await service.start({ jarvisRunId: null, industry: "γιατροί αισθητικής", location: "Ελλάδα", limit: 5, criteria: { maxCandidates: 5, testOnly: true } });
  for (let pass = 0; pass < 7 && result.status === "partial"; pass++) result = await service.continue({ researchRunId: result.researchRunId });
  const candidates = result.researchRunId ? await repositories.research.listCandidates(result.researchRunId) : [];
  const findings = candidates.map((candidate) => ({
    name: candidate.businessName,
    location: candidate.location,
    candidateStatus: candidate.status,
    officialWebsite: candidate.officialWebsite,
    sources: [...new Set(candidate.sourceResults.map((source) => source.url))].slice(0, 5),
  }));
  console.log(JSON.stringify({ test: "TEST RESEARCH", runId: result.researchRunId, status: result.status, discovered: result.discoveredCount, qualified: result.qualifiedCount, processed: result.processedCount, findings }));
  if (result.status !== "completed") process.exitCode = 1;
}

void main().catch((error) => {
  console.error(JSON.stringify({ test: "TEST RESEARCH", status: "failed", error: error instanceof Error ? error.message : "Unknown error" }));
  process.exitCode = 1;
});
