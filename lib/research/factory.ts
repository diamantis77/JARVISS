import type { RuntimeMode } from "../config/runtime";
import type { Repositories } from "../repositories/contracts";
import { isOpenAiConfigured } from "../config/runtime";
import { allowPaidFallback } from "../ai/routing-config";
import { DemoResearchProvider } from "./demo-provider";
import { OpenAIWebResearchProvider } from "./openai-web-provider";
import { LeadResearchService } from "./service";
import { SecureWebsiteFetcher } from "./website-fetcher";
import { DeterministicWebsiteAnalyzer } from "./website-analyzer";
import { createAdminClient } from "../supabase/admin";
import { SupabaseJobQueue } from "../jobs/supabase-queue";

export function isLiveResearchEnabled() { return process.env.LIVE_RESEARCH_ENABLED?.toLowerCase() === "true"; }
export function createResearchService(repositories: Repositories, mode: RuntimeMode, ownerUserId?: string) {
  if (mode === "demo") { const provider = new DemoResearchProvider(); return new LeadResearchService(repositories, provider, provider, null, null, "demo"); }
  if (!isLiveResearchEnabled() || !isOpenAiConfigured() || !allowPaidFallback()) return new LeadResearchService(repositories, null, null, null, null, "disabled");
  const enqueue = ownerUserId ? async (researchRunId: string) => {
    await new SupabaseJobQueue(createAdminClient()).enqueue({ userId: ownerUserId, jobType: "research_continue", priority: 35, deduplicationKey: `research-start:${researchRunId}`, payload: { researchRunId } });
  } : undefined;
  const provider = new OpenAIWebResearchProvider(); return new LeadResearchService(repositories, provider, provider, new SecureWebsiteFetcher(), new DeterministicWebsiteAnalyzer(), "live", enqueue);
}
