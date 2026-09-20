import OpenAI from "openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { z } from "zod";
import type { BusinessDiscoveryProvider, DiscoveredBusiness, WebResearchProvider, WebSearchResult } from "./contracts";

const resultSchema = z.object({ title: z.string(), url: z.string().url(), snippet: z.string().default(""), sourceType: z.enum(["official_website", "official_profile", "directory", "search_result"]).default("search_result") });
const searchSchema = z.object({ results: z.array(resultSchema).max(100) });
const candidateSchema = z.object({ businessName: z.string().min(1), industry: z.string().min(1), location: z.string().min(1), officialWebsite: z.string().url().nullable().default(null), phone: z.string().nullable().default(null), email: z.string().email().nullable().default(null), confidence: z.enum(["verified", "high", "medium", "low", "unknown"]).default("low"), sourceUrls: z.array(z.string().url()).min(1) });
const discoverySchema = z.object({ businesses: z.array(candidateSchema).max(100) });

function jsonObject(text: string) {
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Research provider did not return structured JSON");
  return JSON.parse(text.slice(start, end + 1));
}

function citationKey(value: string) { try { const url = new URL(value); url.hash = ""; url.pathname = url.pathname.replace(/\/$/, "") || "/"; return url.toString().replace(/\/$/, ""); } catch { return value; } }

function citedResults(response: OpenAIResponse) {
  const citations = new Map<string, { title: string; url: string }>();
  for (const item of response.output) {
    if (item.type === "message") for (const content of item.content) if (content.type === "output_text") for (const annotation of content.annotations) if (annotation.type === "url_citation") citations.set(citationKey(annotation.url), { title: annotation.title, url: annotation.url });
    if (item.type === "web_search_call" && item.action.type === "search") for (const source of item.action.sources ?? []) if (!citations.has(citationKey(source.url))) citations.set(citationKey(source.url), { title: new URL(source.url).hostname, url: source.url });
  }
  return citations;
}

function safeHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null; } catch { return null; } }

export class OpenAIWebResearchProvider implements WebResearchProvider, BusinessDiscoveryProvider {
  readonly name = "openai-web-search";
  private readonly client: OpenAI;
  constructor(apiKey = process.env.OPENAI_API_KEY, private readonly model = process.env.OPENAI_RESEARCH_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5") { if (!apiKey) throw new Error("OPENAI_API_KEY is not configured"); this.client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 }); }

  private async research(prompt: string) {
    return this.client.responses.create({ model: this.model, tools: [{ type: "web_search", search_context_size: "medium", external_web_access: true }], tool_choice: "required", include: ["web_search_call.action.sources"], instructions: "Use live public web search. Return only the requested JSON object. Never invent businesses, URLs, contact details, or facts. Search snippets are discovery evidence, not verified facts. Prefer official first-party sources and keep uncertain values null.", input: prompt });
  }

  async searchWeb({ query, location, maxResults }: { query: string; location?: string; maxResults: number }) {
    try {
      const response = await this.research(`Search the public web for: ${query}${location ? `\nGeographic focus: ${location}` : ""}\nReturn at most ${maxResults} results as {"results":[{"title":"","url":"https://...","snippet":"","sourceType":"official_website|official_profile|directory|search_result"}]}. Every URL must be a source actually found by web search.`);
      const citations = citedResults(response); const parsed = searchSchema.parse(jsonObject(response.output_text));
      const results = parsed.results.flatMap((result) => { const url = safeHttpUrl(result.url); const citation = url ? citations.get(citationKey(url)) : null; if (!url || !citation) return []; return [{ ...result, title: citation.title || result.title, url: citation.url }]; }).slice(0, maxResults);
      return { results };
    } catch { return { results: [], error: "Live web search failed." }; }
  }

  async discover({ industry, location, limit, criteria }: { industry: string; location: string; limit: number; criteria?: Record<string, unknown> }) {
    try {
      const response = await this.research(`Discover real public businesses for legitimate B2B research.\nIndustry: ${industry}\nLocation: ${location}\nMaximum candidates: ${limit}\nCriteria: ${JSON.stringify(criteria ?? {})}\nSeparate discovery from verification. Use an official website only when identity and location match. Return {"businesses":[{"businessName":"","industry":"","location":"","officialWebsite":null,"phone":null,"email":null,"confidence":"verified|high|medium|low|unknown","sourceUrls":["https://..."]}]}. Contact details may only come from public business sources.`);
      const citations = citedResults(response); const parsed = discoverySchema.parse(jsonObject(response.output_text));
      const businesses: DiscoveredBusiness[] = [];
      for (const candidate of parsed.businesses) {
        const sourceUrls = candidate.sourceUrls.map(safeHttpUrl).filter((url): url is string => Boolean(url)).filter((url) => citations.has(citationKey(url)));
        if (!sourceUrls.length) continue;
        const sources: WebSearchResult[] = sourceUrls.map((url) => { const citation = citations.get(citationKey(url))!; return { title: citation.title ?? new URL(url).hostname, url: citation.url, snippet: "Discovered through OpenAI web search.", sourceType: candidate.officialWebsite && new URL(candidate.officialWebsite).hostname.replace(/^www\./, "") === new URL(url).hostname.replace(/^www\./, "") ? "official_website" : "search_result" }; });
        const safeOfficialWebsite = candidate.officialWebsite ? safeHttpUrl(candidate.officialWebsite) : null;
        const officialWebsite = safeOfficialWebsite && sourceUrls.some((url) => new URL(url).hostname.replace(/^www\./, "") === new URL(safeOfficialWebsite).hostname.replace(/^www\./, "")) ? safeOfficialWebsite : null;
        businesses.push({ ...candidate, officialWebsite, confidence: officialWebsite && candidate.confidence === "verified" ? "verified" : candidate.confidence === "verified" ? "high" : candidate.confidence, sources });
      }
      return { businesses: businesses.slice(0, limit), searched: true };
    } catch { return { businesses: [], searched: false, error: "Live business discovery failed." }; }
  }
}
