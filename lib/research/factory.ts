import "server-only";
import type { RuntimeMode } from "../config/runtime";
import type { Repositories } from "../repositories/contracts";
import { isOpenAiConfigured } from "../config/runtime";
import { DemoResearchProvider } from "./demo-provider";
import { OpenAIWebResearchProvider } from "./openai-web-provider";
import { LeadResearchService } from "./service";
import { SecureWebsiteFetcher } from "./website-fetcher";
import { DeterministicWebsiteAnalyzer } from "./website-analyzer";

export function isLiveResearchEnabled() { return process.env.LIVE_RESEARCH_ENABLED?.toLowerCase() === "true"; }
export function createResearchService(repositories: Repositories, mode: RuntimeMode) {
  if (mode === "demo") { const provider = new DemoResearchProvider(); return new LeadResearchService(repositories, provider, provider, null, null, "demo"); }
  if (!isLiveResearchEnabled() || !isOpenAiConfigured()) return new LeadResearchService(repositories, null, null, null, null, "disabled");
  const provider = new OpenAIWebResearchProvider(); return new LeadResearchService(repositories, provider, provider, new SecureWebsiteFetcher(), new DeterministicWebsiteAnalyzer(), "live");
}
