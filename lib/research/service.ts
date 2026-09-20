import type { Repositories } from "../repositories/contracts";
import { scoreLeadV2, type EvidenceFact } from "../scoring";
import type { EvidenceConfidence, Lead, LeadEvidence, ResearchCandidate, ResearchRun, WebsiteAnalysis } from "../../types";
import { candidateIdentityKey, deduplicateCandidates, normalizedDomain } from "./identity";
import type { BusinessDiscoveryProvider, ResearchBatchResult, ResearchProgress, ResearchService, WebResearchProvider, WebsiteAnalyzer, WebsiteFetcher } from "./contracts";

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, Math.floor(value)));
const configuredLimit = (name: string, fallback: number, minimum: number, maximum: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(fallback, clamp(value, minimum, maximum)) : fallback;
};
const fact = <T>(value: T | null, confidence: EvidenceConfidence, evidenceIds: string[]): EvidenceFact<T> => ({ value, confidence: value === null ? "unknown" : confidence, evidenceIds: value === null ? [] : evidenceIds });
const compactLead = (lead: Lead) => ({ id: lead.id, businessName: lead.businessName, category: lead.category, city: lead.city, score: lead.score, status: lead.status, opportunitySummary: lead.opportunitySummary, source: lead.source });

export class LeadResearchService implements ResearchService {
  readonly available: boolean;
  constructor(private readonly repositories: Repositories, private readonly discovery: BusinessDiscoveryProvider | null, private readonly web: WebResearchProvider | null, private readonly fetcher: WebsiteFetcher | null, private readonly analyzer: WebsiteAnalyzer | null, readonly mode: "demo" | "live" | "disabled") { this.available = Boolean(discovery && web && (mode === "demo" || fetcher && analyzer)); }

  async searchWeb(input: { query: string; location?: string; maxResults: number }) {
    if (!this.web || !this.available) return { results: [], error: "Live web research is not configured." };
    return this.web.searchWeb({ ...input, maxResults: clamp(input.maxResults, 1, 25) });
  }

  async start({ jarvisRunId, industry, location, limit, criteria, onProgress }: { jarvisRunId: string; industry: string; location: string; limit: number; criteria?: Record<string, unknown>; onProgress?: (progress: ResearchProgress) => Promise<void> | void }): Promise<ResearchBatchResult> {
    if (!this.discovery || !this.available) return this.unavailable();
    const settings = await this.repositories.settings.get();
    const hardCap = clamp(Number(process.env.RESEARCH_MAX_LEADS ?? 50), 1, 50);
    const requestedLimit = Math.min(clamp(limit, 1, 50), settings.researchMaxLeads, hardCap);
    const maxPages = configuredLimit("RESEARCH_MAX_PAGES_PER_SITE", settings.researchMaxPagesPerSite, 1, 5);
    const timeoutMs = configuredLimit("RESEARCH_FETCH_TIMEOUT_MS", settings.researchFetchTimeoutMs, 2_000, 20_000);
    const concurrency = configuredLimit("RESEARCH_MAX_CONCURRENCY", settings.researchMaxConcurrency, 1, 5);
    let run = await this.repositories.research.createRun({ jarvisRunId, query: `${industry} · ${location}`, industry, location, requestedLimit, config: { criteria: criteria ?? {}, batchSize: 5, maxPages, timeoutMs, concurrency, aiAnalysis: settings.researchAiAnalysisEnabled, mode: this.mode } });
    await this.repositories.activity.create({ eventType: "analysis", title: "Research started", description: `${industry} · ${location}`, metadata: { researchRunId: run.id } });
    await onProgress?.({ researchRunId: run.id, status: "running", description: "Public web search started.", processed: 0, total: requestedLimit });
    const discovery = await this.discovery.discover({ industry, location, limit: requestedLimit, criteria });
    if (this.mode === "live" && !discovery.searched) {
      run = await this.repositories.research.updateRun(run.id, { status: "failed", completedAt: new Date().toISOString() });
      return { ...this.counts(run), researchRunId: run.id, status: "failed", message: discovery.error ?? "Live web search failed.", leads: [] };
    }
    const candidates = deduplicateCandidates(discovery.businesses).slice(0, requestedLimit);
    await this.repositories.research.addCandidates(run.id, candidates.map((candidate) => ({ businessName: candidate.businessName, normalizedKey: candidateIdentityKey(candidate), industry: candidate.industry, location: candidate.location, officialWebsite: candidate.officialWebsite, phone: candidate.phone, email: candidate.email, status: "discovered", sourceResults: candidate.sources })));
    run = await this.repositories.research.updateRun(run.id, { discoveredCount: candidates.length, status: candidates.length ? "running" : "completed", completedAt: candidates.length ? null : new Date().toISOString() });
    await onProgress?.({ researchRunId: run.id, status: run.status, description: `${candidates.length} unique candidate businesses identified.`, processed: 0, total: candidates.length });
    if (!candidates.length) return { ...this.counts(run), researchRunId: run.id, status: "completed", message: "Research completed with no sufficiently supported candidate businesses.", leads: [] };
    return this.continue({ researchRunId: run.id, onProgress });
  }

  async continue({ researchRunId, onProgress }: { researchRunId: string; onProgress?: (progress: ResearchProgress) => Promise<void> | void }): Promise<ResearchBatchResult> {
    const storedRun = await this.repositories.research.getRun(researchRunId);
    if (!storedRun) return { researchRunId, status: "failed", discoveredCount: 0, verifiedCount: 0, analyzedCount: 0, qualifiedCount: 0, failedCount: 1, processedCount: 0, message: "Research run was not found.", leads: [] };
    let run: ResearchRun = storedRun;
    if (run.status === "cancelled") return { ...this.counts(run), researchRunId, status: "cancelled", message: "Research was cancelled. Completed evidence was preserved.", leads: [] };
    if (run.status === "partial") run = await this.repositories.research.claimContinuation(researchRunId);
    const pending = await this.repositories.research.listPendingCandidates(researchRunId, 5);
    const settings = await this.repositories.settings.get();
    const concurrency = configuredLimit("RESEARCH_MAX_CONCURRENCY", settings.researchMaxConcurrency, 1, 5);
    const qualifiedLeads: Lead[] = [];
    for (let index = 0; index < pending.length; index += concurrency) {
      const batch = pending.slice(index, index + concurrency);
      await Promise.all(batch.map(async (candidate) => {
        const current = (await this.repositories.research.getRun(researchRunId)) ?? run;
        if (current.status === "cancelled") return;
        await onProgress?.({ researchRunId, status: "running", description: `Researching ${candidate.businessName} · ${current.processedCount + 1}/${current.discoveredCount}`, processed: current.processedCount, total: current.discoveredCount, metadata: { candidateId: candidate.id } });
        try { const lead = await this.processCandidate(current, candidate); if (lead) qualifiedLeads.push(lead); }
        catch { await this.repositories.research.updateCandidate(candidate.id, { status: "failed", error: "Candidate research failed safely." }); }
      }));
      run = await this.recount(researchRunId);
      await onProgress?.({ researchRunId, status: "running", description: `Persisted progress · ${run.processedCount}/${run.discoveredCount} candidates processed.`, processed: run.processedCount, total: run.discoveredCount });
    }
    run = await this.recount(researchRunId);
    const remaining = await this.repositories.research.listPendingCandidates(researchRunId, 1);
    const status = run.status === "cancelled" ? "cancelled" : remaining.length ? "partial" : "completed";
    run = await this.repositories.research.updateRun(researchRunId, { status, completedAt: status === "completed" || status === "cancelled" ? new Date().toISOString() : null });
    const languageGreek = /[Α-ω]/u.test(run.query);
    const message = status === "partial" ? `Research progress saved: ${run.processedCount}/${run.discoveredCount} candidates processed. The next batch can resume safely.` : status === "cancelled" ? "Research cancelled. Completed research and evidence were preserved." : languageGreek ? `Η έρευνα ολοκληρώθηκε. ${run.discoveredCount} μοναδικές επιχειρήσεις, ${run.verifiedCount} επαληθευμένες, ${run.analyzedCount} αναλυμένες και ${run.qualifiedCount} qualified leads.` : `Research completed. ${run.discoveredCount} unique businesses, ${run.verifiedCount} verified, ${run.analyzedCount} analyzed, and ${run.qualifiedCount} qualified leads.`;
    return { ...this.counts(run), researchRunId, status, message, leads: qualifiedLeads.map(compactLead) };
  }

  async cancel(researchRunId: string) { await this.repositories.research.cancel(researchRunId); }

  async analyzeWebsite({ leadId, url, onProgress }: { leadId: string; url: string; onProgress?: (progress: ResearchProgress) => Promise<void> | void }) {
    const lead = await this.repositories.leads.getById(leadId);
    if (!lead) return { message: "Lead not found." };
    if (this.mode !== "live" || !this.fetcher || !this.analyzer) return { message: this.mode === "demo" ? "Demo Research uses fictional seeded website signals only." : "Live web research is not configured." };
    const settings = await this.repositories.settings.get();
    await onProgress?.({ researchRunId: "", status: "running", description: `Fetching selected public pages for ${lead.businessName}.`, processed: 0, total: 1 });
    const fetched = await this.fetcher.fetchSite(url, { maxPages: configuredLimit("RESEARCH_MAX_PAGES_PER_SITE", settings.researchMaxPagesPerSite, 1, 5), timeoutMs: configuredLimit("RESEARCH_FETCH_TIMEOUT_MS", settings.researchFetchTimeoutMs, 2_000, 20_000) });
    const analyzed = await this.analyzer.analyze({ websiteUrl: url, pages: fetched.pages, enableAi: settings.researchAiAnalysisEnabled, leadId });
    const source = await this.repositories.evidence.addSource({ leadId, researchRunId: null, candidateId: null, sourceType: "official_website", sourceUrl: url, title: analyzed.title ?? lead.businessName, provider: "secure-website-fetcher", metadata: { pagesAnalyzed: analyzed.pagesAnalyzed.length } });
    const claims = [
      { fieldName: "website", valueText: url, confidence: "verified" as const, evidenceSummary: "Website was fetched and analyzed as the lead's public website." },
      { fieldName: "contact_path", valueText: analyzed.email ?? analyzed.phone ?? "Unknown", confidence: analyzed.email || analyzed.phone ? analyzed.confidence : "unknown" as const, evidenceSummary: analyzed.email || analyzed.phone ? "Public contact path detected on analyzed pages." : "No public contact path was verified." },
      { fieldName: "mobile_viewport", valueText: analyzed.hasViewportMeta === null ? "Unknown" : analyzed.hasViewportMeta ? "Detected" : "Not detected on analyzed pages", confidence: analyzed.confidence, evidenceSummary: `${analyzed.pagesAnalyzed.length} page(s) analyzed.` },
      { fieldName: "online_booking", valueText: analyzed.hasBooking === null ? "Unknown" : analyzed.hasBooking ? "Detected" : "Not detected on analyzed pages", confidence: analyzed.confidence, evidenceSummary: `${analyzed.pagesAnalyzed.length} page(s) analyzed.` },
      { fieldName: "clear_cta", valueText: analyzed.hasClearCta === null ? "Unknown" : analyzed.hasClearCta ? "Detected" : "Not detected on analyzed pages", confidence: analyzed.confidence, evidenceSummary: `${analyzed.pagesAnalyzed.length} page(s) analyzed.` },
    ];
    const evidence = await Promise.all(claims.map((claim) => this.repositories.evidence.addEvidence({ leadId, sourceId: source.id, ...claim, verifiedAt: claim.confidence === "verified" ? new Date().toISOString() : null })));
    const candidate: ResearchCandidate = { id: "single", researchRunId: "single", businessName: lead.businessName, normalizedKey: candidateIdentityKey({ businessName: lead.businessName, location: lead.city, officialWebsite: url, phone: lead.phone }), industry: lead.category, location: lead.city, officialWebsite: url, phone: lead.phone, email: lead.email, status: "analyzed", sourceResults: [{ title: source.title, url, snippet: "Official website fetched directly.", sourceType: "official_website" }], leadId, error: null, createdAt: new Date().toISOString() };
    const score = this.score(candidate, analyzed, evidence);
    await this.repositories.leads.update(leadId, { website: url, email: analyzed.email ?? lead.email, phone: analyzed.phone ?? lead.phone, score: score.score, scoreReason: score.reasons.join(" ") || "No scored gap was supported by evidence.", scoreComponents: score.components, evidenceIds: score.evidenceIds, opportunitySummary: analyzed.opportunities[0] ?? analyzed.digitalGaps[0] ?? "Research completed; opportunity remains Unknown.", researchConfidence: analyzed.confidence, lastResearchedAt: new Date().toISOString(), status: score.score >= settings.minimumLeadScore ? "qualified" : "analyzed" });
    const analysis = await this.repositories.evidence.addWebsiteAnalysis(analyzed);
    return { message: `Website research completed using ${analysis.pagesAnalyzed.length} public page(s).`, analysis };
  }

  private async processCandidate(run: ResearchRun, candidate: ResearchCandidate) {
    const settings = await this.repositories.settings.get();
    const primaryUrl = candidate.officialWebsite ?? candidate.sourceResults[0]?.url;
    if (!primaryUrl) throw new Error("Candidate has no cited public source");
    const source = await this.repositories.evidence.addSource({ leadId: null, researchRunId: run.id, candidateId: candidate.id, sourceType: candidate.officialWebsite ? "official_website" : "search_result", sourceUrl: primaryUrl, title: candidate.sourceResults[0]?.title ?? candidate.businessName, provider: this.discovery?.name ?? "unknown", metadata: { fictional: this.mode === "demo", provisional: true, sourceCount: candidate.sourceResults.length } });
    const sourceIds = [source.id];
    let analysis: Omit<WebsiteAnalysis, "id" | "retrievedAt">;
    if (this.mode === "demo") analysis = this.demoAnalysis(candidate);
    else if (candidate.officialWebsite && this.fetcher && this.analyzer) { const fetched = await this.fetcher.fetchSite(candidate.officialWebsite, { maxPages: configuredLimit("RESEARCH_MAX_PAGES_PER_SITE", settings.researchMaxPagesPerSite, 1, 5), timeoutMs: configuredLimit("RESEARCH_FETCH_TIMEOUT_MS", settings.researchFetchTimeoutMs, 2_000, 20_000) }); analysis = await this.analyzer.analyze({ websiteUrl: candidate.officialWebsite, pages: fetched.pages, enableAi: settings.researchAiAnalysisEnabled, candidateId: candidate.id }); }
    else analysis = this.unknownAnalysis(candidate);
    const preliminary = this.score(candidate, analysis, sourceIds);
    const existing = await this.findExistingLead(candidate);
    if (preliminary.score < settings.minimumLeadScore && !existing) { await this.repositories.evidence.addWebsiteAnalysis(analysis); await this.repositories.research.updateCandidate(candidate.id, { status: "analyzed" }); return null; }
    const leadInput = { businessName: candidate.businessName, category: candidate.industry, city: candidate.location, country: "Unknown", website: candidate.officialWebsite, email: analysis.email ?? candidate.email, phone: analysis.phone ?? candidate.phone, source: this.mode === "demo" ? "demo" as const : "provider" as const, status: preliminary.score >= settings.minimumLeadScore ? "qualified" as const : "analyzed" as const, score: preliminary.score, scoreReason: preliminary.reasons.join(" ") || "Evidence was insufficient for opportunity scoring.", opportunitySummary: analysis.opportunities[0] ?? analysis.digitalGaps[0] ?? "Research completed; opportunity remains Unknown.", reviewCount: null, scoreComponents: preliminary.components, evidenceIds: preliminary.evidenceIds, researchConfidence: analysis.confidence, lastResearchedAt: new Date().toISOString() };
    let lead = existing ? await this.repositories.leads.update(existing.id, leadInput) : await this.repositories.leads.create(leadInput);
    const leadSources = await Promise.all(candidate.sourceResults.map((item) => this.repositories.evidence.addSource({ leadId: lead.id, researchRunId: run.id, candidateId: candidate.id, sourceType: item.sourceType === "official_website" || item.sourceType === "official_profile" || item.sourceType === "directory" ? item.sourceType : "search_result", sourceUrl: item.url, title: item.title, provider: this.discovery?.name ?? "unknown", metadata: { fictional: this.mode === "demo", snippet: item.snippet } })));
    const evidence = await this.persistLeadEvidence(lead.id, leadSources[0]?.id ?? source.id, candidate, analysis);
    const finalScore = this.score(candidate, analysis, evidence.map((item) => item.id));
    lead = await this.repositories.leads.update(lead.id, { score: finalScore.score, scoreReason: finalScore.reasons.join(" ") || "Evidence was insufficient for opportunity scoring.", scoreComponents: finalScore.components, evidenceIds: finalScore.evidenceIds, researchConfidence: analysis.confidence, lastResearchedAt: new Date().toISOString() });
    await this.repositories.evidence.addWebsiteAnalysis({ ...analysis, leadId: lead.id });
    await this.repositories.research.updateCandidate(candidate.id, { status: lead.status === "qualified" ? "qualified" : "analyzed", leadId: lead.id, phone: lead.phone, email: lead.email });
    await this.repositories.activity.create({ eventType: "score", title: `Lead scored ${lead.score}/100`, description: lead.businessName, metadata: { leadId: lead.id, researchRunId: run.id } });
    return lead;
  }

  private score(candidate: ResearchCandidate, analysis: Omit<WebsiteAnalysis, "id" | "retrievedAt">, evidence: string[] | LeadEvidence[]) {
    const fallbackIds = typeof evidence[0] === "string" ? evidence as string[] : [];
    const idsFor = (...fields: string[]) => Array.isArray(evidence) && typeof evidence[0] !== "string" ? (evidence as LeadEvidence[]).filter((item) => fields.includes(item.fieldName)).map((item) => item.id) : fallbackIds;
    const identityIds = idsFor("business_identity"); const locationIds = idsFor("location"); const contactIds = idsFor("contact_path"); const websiteIds = idsFor("website", "online_booking", "clear_cta", "mobile_viewport");
    const confidence = analysis.confidence;
    return scoreLeadV2({
      serviceFit: fact(true, candidate.sourceResults.length ? "medium" : "unknown", identityIds),
      targetGeography: fact(true, candidate.sourceResults.length ? "medium" : "unknown", locationIds),
      activeBusiness: fact(candidate.sourceResults.length > 0, candidate.sourceResults.length > 1 ? "high" : "medium", identityIds),
      contactable: fact(analysis.hasEmail || analysis.hasPhone || Boolean(candidate.email || candidate.phone), confidence, contactIds),
      websiteQuality: fact(analysis.digitalGaps.length ? "needs_work" : analysis.status === "completed" ? "strong" : null, confidence, websiteIds),
      mobileBasics: fact(analysis.hasViewportMeta === null ? null : analysis.hasViewportMeta ? "strong" : "poor", confidence, idsFor("mobile_viewport")),
      booking: fact(analysis.hasBooking === null ? null : analysis.hasBooking ? "available" : "missing", confidence, idsFor("online_booking")),
      clearCta: fact(analysis.hasClearCta, confidence, idsFor("clear_cta")),
    });
  }

  private async persistLeadEvidence(leadId: string, sourceId: string, candidate: ResearchCandidate, analysis: Omit<WebsiteAnalysis, "id" | "retrievedAt">) { const claims = [{ fieldName: "business_identity", valueText: candidate.businessName, confidence: candidate.officialWebsite ? "high" as const : "medium" as const, summary: `Business identity supported by ${candidate.sourceResults.length} public source(s).` }, { fieldName: "location", valueText: candidate.location, confidence: "medium" as const, summary: "Location reported by public business research." }, { fieldName: "website", valueText: candidate.officialWebsite ?? "Unknown", confidence: candidate.officialWebsite ? "verified" as const : "unknown" as const, summary: candidate.officialWebsite ? "Official website identity matched." : "No official website was confidently identified." }, { fieldName: "contact_path", valueText: analysis.email ?? analysis.phone ?? candidate.email ?? candidate.phone ?? "Unknown", confidence: analysis.email || analysis.phone || candidate.email || candidate.phone ? analysis.confidence : "unknown" as const, summary: analysis.email || analysis.phone ? "Public contact path detected on analyzed pages." : "No public contact path was verified." }, { fieldName: "mobile_viewport", valueText: analysis.hasViewportMeta === null ? "Unknown" : analysis.hasViewportMeta ? "Detected" : "Not detected on analyzed pages", confidence: analysis.confidence, summary: analysis.hasViewportMeta === null ? "Website unavailable; mobile viewport remains Unknown." : `${analysis.pagesAnalyzed.length} page(s) analyzed.` }, { fieldName: "online_booking", valueText: analysis.hasBooking === null ? "Unknown" : analysis.hasBooking ? "Detected" : "Not detected on analyzed pages", confidence: analysis.confidence, summary: analysis.hasBooking === null ? "Website unavailable; booking remains Unknown." : `${analysis.pagesAnalyzed.length} page(s) analyzed.` }, { fieldName: "clear_cta", valueText: analysis.hasClearCta === null ? "Unknown" : analysis.hasClearCta ? "Detected" : "Not detected on analyzed pages", confidence: analysis.confidence, summary: `${analysis.pagesAnalyzed.length} page(s) analyzed.` }]; return Promise.all(claims.map((claim) => this.repositories.evidence.addEvidence({ leadId, sourceId, fieldName: claim.fieldName, valueText: claim.valueText, confidence: claim.confidence, evidenceSummary: claim.summary, verifiedAt: claim.confidence === "verified" ? new Date().toISOString() : null }))); }

  private async findExistingLead(candidate: ResearchCandidate) { const leads = await this.repositories.leads.list(); const domain = normalizedDomain(candidate.officialWebsite); return leads.find((lead) => domain && normalizedDomain(lead.website) === domain || lead.businessName.toLowerCase() === candidate.businessName.toLowerCase() && lead.city.toLowerCase() === candidate.location.toLowerCase()) ?? null; }
  private demoAnalysis(candidate: ResearchCandidate): Omit<WebsiteAnalysis, "id" | "retrievedAt"> { const hasSite = Boolean(candidate.officialWebsite); return { leadId: null, candidateId: candidate.id, websiteUrl: candidate.officialWebsite ?? candidate.sourceResults[0]?.url, status: hasSite ? "completed" : "failed", title: hasSite ? `${candidate.businessName} · fictional demo` : null, metaDescription: null, language: "en", hasViewportMeta: hasSite ? false : null, hasContactForm: hasSite ? false : null, hasBooking: hasSite ? false : null, hasClearCta: hasSite ? false : null, hasPhone: candidate.phone ? true : hasSite ? false : null, hasEmail: candidate.email ? true : hasSite ? false : null, hasHttps: hasSite, phone: candidate.phone, email: candidate.email, pagesAnalyzed: hasSite ? [candidate.officialWebsite!] : [], visibleText: "Fictional demo evidence only.", strengths: [], digitalGaps: hasSite ? ["Fictional demo: no booking path or clear CTA in seeded signals."] : [], opportunities: hasSite ? ["Fictional demo opportunity: improve the conversion journey."] : [], unknowns: hasSite ? [] : ["Website is Unknown in the fictional dataset."], confidence: hasSite ? "medium" : "unknown" }; }
  private unknownAnalysis(candidate: ResearchCandidate): Omit<WebsiteAnalysis, "id" | "retrievedAt"> { return { leadId: null, candidateId: candidate.id, websiteUrl: candidate.officialWebsite ?? candidate.sourceResults[0]?.url, status: "failed", title: null, metaDescription: null, language: null, hasViewportMeta: null, hasContactForm: null, hasBooking: null, hasClearCta: null, hasPhone: null, hasEmail: null, hasHttps: Boolean(candidate.officialWebsite?.startsWith("https:")), phone: candidate.phone, email: candidate.email, pagesAnalyzed: [], visibleText: "", strengths: [], digitalGaps: [], opportunities: [], unknowns: ["No official website was confidently identified or fetched."], confidence: "unknown" }; }
  private async recount(id: string) { const run = await this.repositories.research.getRun(id); if (!run) throw new Error("Research run not found"); const candidates = await this.repositories.research.listCandidates(id); const processed = candidates.filter((item) => item.status !== "discovered"); return this.repositories.research.updateRun(id, { verifiedCount: candidates.filter((item) => Boolean(item.officialWebsite)).length, analyzedCount: candidates.filter((item) => item.status === "analyzed" || item.status === "qualified").length, qualifiedCount: candidates.filter((item) => item.status === "qualified").length, failedCount: candidates.filter((item) => item.status === "failed").length, processedCount: processed.length }); }
  private counts(run: NonNullable<Awaited<ReturnType<Repositories["research"]["getRun"]>>>) { return { discoveredCount: run.discoveredCount, verifiedCount: run.verifiedCount, analyzedCount: run.analyzedCount, qualifiedCount: run.qualifiedCount, failedCount: run.failedCount, processedCount: run.processedCount }; }
  private unavailable(): ResearchBatchResult { return { researchRunId: "", status: "failed", discoveredCount: 0, verifiedCount: 0, analyzedCount: 0, qualifiedCount: 0, failedCount: 0, processedCount: 0, message: "Live web research is not configured.", leads: [] }; }
}
