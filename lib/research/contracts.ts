import type { EvidenceConfidence, ResearchCandidate, WebsiteAnalysis, WebsiteSignals } from "../../types";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceType: "official_website" | "official_profile" | "directory" | "search_result";
}

export interface DiscoveredBusiness {
  businessName: string;
  industry: string;
  location: string;
  officialWebsite: string | null;
  phone: string | null;
  email: string | null;
  confidence: EvidenceConfidence;
  sources: WebSearchResult[];
}

export interface WebResearchProvider {
  readonly name: string;
  searchWeb(input: { query: string; location?: string; maxResults: number }): Promise<{ results: WebSearchResult[]; error?: string }>;
}

export interface BusinessDiscoveryProvider {
  readonly name: string;
  discover(input: { industry: string; location: string; limit: number; criteria?: Record<string, unknown> }): Promise<{ businesses: DiscoveredBusiness[]; searched: boolean; error?: string }>;
}

export interface WebsiteFetcher {
  fetchSite(url: string, options: { maxPages: number; timeoutMs: number }): Promise<{ status: "completed" | "partial" | "failed"; pages: FetchedWebsitePage[]; errors: string[] }>;
}

export interface FetchedWebsitePage {
  url: string;
  status: number;
  contentType: string;
  html: string;
}

export interface WebsiteAnalyzer {
  analyze(input: { websiteUrl: string; pages: FetchedWebsitePage[]; enableAi: boolean; candidateId?: string; leadId?: string }): Promise<Omit<WebsiteAnalysis, "id" | "retrievedAt">>;
}

export interface ResearchProgress {
  researchRunId: string;
  status: string;
  description: string;
  processed: number;
  total: number;
  metadata?: Record<string, unknown>;
}

export interface ResearchService {
  readonly available: boolean;
  readonly mode: "demo" | "live" | "disabled";
  searchWeb(input: { query: string; location?: string; maxResults: number }): Promise<{ results: WebSearchResult[]; error?: string }>;
  start(input: { jarvisRunId: string; industry: string; location: string; limit: number; criteria?: Record<string, unknown>; onProgress?: (progress: ResearchProgress) => Promise<void> | void }): Promise<ResearchBatchResult>;
  continue(input: { researchRunId: string; onProgress?: (progress: ResearchProgress) => Promise<void> | void }): Promise<ResearchBatchResult>;
  analyzeWebsite(input: { leadId: string; url: string; onProgress?: (progress: ResearchProgress) => Promise<void> | void }): Promise<{ message: string; analysis?: WebsiteAnalysis }>;
  cancel(researchRunId: string): Promise<void>;
}

export interface ResearchBatchResult {
  researchRunId: string;
  status: "partial" | "completed" | "cancelled" | "failed";
  discoveredCount: number;
  verifiedCount: number;
  analyzedCount: number;
  qualifiedCount: number;
  failedCount: number;
  processedCount: number;
  message: string;
  leads: Array<{ id: string; businessName: string; category: string; city: string; score: number; status: string; opportunitySummary: string; source: string }>;
}

export interface ExtractedWebsitePage extends WebsiteSignals {
  url: string;
  relevantLinks: string[];
}

export type PersistedResearchCandidate = ResearchCandidate;
