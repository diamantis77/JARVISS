import type { Repositories } from "../repositories/contracts";
import { scoreLeadV2, type EvidenceFact } from "../scoring";
import type { EvidenceConfidence, Lead, LeadEvidence, ResearchCandidate, ResearchRun, WebsiteAnalysis } from "../../types";
import { candidateIdentityKey, deduplicateCandidates, normalizedDomain, normalizedNameLocation } from "./identity";
import type { BusinessDiscoveryProvider, ResearchBatchResult, ResearchProgress, ResearchService, WebResearchProvider, WebsiteAnalyzer, WebsiteFetcher } from "./contracts";
import type { WebsiteVerificationStatus } from "./contracts";
import { verifyOfficialWebsite, websiteIdentityMatches } from "./website-verification";
import { athensDayStartUtc } from "./dates";

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, Math.floor(value)));
const configuredLimit = (name: string, fallback: number, minimum: number, maximum: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(fallback, clamp(value, minimum, maximum)) : fallback;
};
const fact = <T>(value: T | null, confidence: EvidenceConfidence, evidenceIds: string[]): EvidenceFact<T> => ({ value, confidence: value === null ? "unknown" : confidence, evidenceIds: value === null ? [] : evidenceIds });
const compactLead = (lead: Lead) => ({ id: lead.id, businessName: lead.businessName, category: lead.category, city: lead.city, score: lead.score, status: lead.status, opportunitySummary: lead.opportunitySummary, source: lead.source });

export class LeadResearchService implements ResearchService {
  readonly available: boolean;
  constructor(private readonly repositories: Repositories, private readonly discovery: BusinessDiscoveryProvider | null, private readonly web: WebResearchProvider | null, private readonly fetcher: WebsiteFetcher | null, private readonly analyzer: WebsiteAnalyzer | null, readonly mode: "demo" | "live" | "disabled", private readonly enqueueResearch?: (researchRunId: string) => Promise<void>) { this.available = Boolean(discovery && web && (mode === "demo" || fetcher && analyzer)); }

  async searchWeb(input: { query: string; location?: string; maxResults: number }) {
    if (!this.web || !this.available) return { results: [], error: "Live web research is not configured." };
    return this.web.searchWeb({ ...input, maxResults: clamp(input.maxResults, 1, 25) });
  }

  async start({ jarvisRunId, industry, location, limit, criteria, onProgress }: { jarvisRunId: string | null; industry: string; location: string; limit: number; criteria?: Record<string, unknown>; onProgress?: (progress: ResearchProgress) => Promise<void> | void }): Promise<ResearchBatchResult> {
    if (!this.discovery || !this.available) return this.unavailable();
    const settings = await this.repositories.settings.get();
    const hardCap = clamp(Number(process.env.RESEARCH_MAX_LEADS ?? 50), 1, 50);
    const requestedLimit = Math.min(clamp(limit, 1, 50), settings.researchMaxLeads, hardCap);
    if (this.mode === "live" && this.repositories.research.countRunsSince) {
      const dailyRuns = await this.repositories.research.countRunsSince(athensDayStartUtc());
      if (dailyRuns >= configuredLimit("RESEARCH_MAX_DAILY_RUNS", 10, 1, 100)) return { ...this.emptyCounts(), researchRunId: "", status: "failed", message: "Daily research run limit reached.", leads: [] };
    }
    const maxPages = configuredLimit("RESEARCH_MAX_PAGES_PER_SITE", settings.researchMaxPagesPerSite, 1, 5);
    const timeoutMs = configuredLimit("RESEARCH_FETCH_TIMEOUT_MS", settings.researchFetchTimeoutMs, 2_000, 20_000);
    const concurrency = this.mode === "live" ? 1 : configuredLimit("RESEARCH_MAX_CONCURRENCY", settings.researchMaxConcurrency, 1, 5);
    const candidateCap = configuredLimit("RESEARCH_MAX_CANDIDATES_PER_RUN", 150, 1, 200);
    const criteriaCap = typeof criteria?.maxCandidates === "number" ? clamp(criteria.maxCandidates, 1, candidateCap) : candidateCap;
    const maxCandidates = Math.min(candidateCap, criteriaCap, Math.max(requestedLimit, requestedLimit * 3));
    const maxSearchQueries = this.mode === "demo" ? 1 : configuredLimit("RESEARCH_MAX_SEARCH_QUERIES_PER_JOB", 30, 1, 100);
    const maxDiscoveryQueries = this.mode === "demo" ? 1 : configuredLimit("RESEARCH_MAX_DISCOVERY_QUERIES_PER_JOB", 3, 1, 8);
    const run = await this.repositories.research.createRun({ jarvisRunId, query: `${industry} · ${location}`, industry, location, requestedLimit, config: { criteria: criteria ?? {}, batchSize: 5, maxPages, timeoutMs, concurrency, aiAnalysis: settings.researchAiAnalysisEnabled, mode: this.mode, maxCandidates, maxSearchQueries, maxDiscoveryQueries, discoveryQueriesUsed: 0, totalQueriesUsed: 0, discoveryComplete: false } });
    await this.repositories.activity.create({ eventType: "analysis", title: "Research started", description: `${industry} · ${location}`, metadata: { researchRunId: run.id } });
    if (this.mode === "live" && requestedLimit > 5 && this.enqueueResearch) {
      try { await this.enqueueResearch(run.id); }
      catch { await this.repositories.research.updateRun(run.id, { status: "failed", completedAt: new Date().toISOString() }); return { ...this.emptyCounts(), researchRunId: run.id, status: "failed", message: "Durable research job could not be queued.", leads: [] }; }
      await onProgress?.({ researchRunId: run.id, status: "pending", description: "Durable web research queued; JARVIS remains available.", processed: 0, total: requestedLimit });
      return { ...this.counts(run), researchRunId: run.id, status: "pending", message: "Η έρευνα μπήκε σε ασφαλή ουρά. Θα συνεχιστεί στο παρασκήνιο χωρίς αποστολή μηνυμάτων.", leads: [] };
    }
    const result = await this.continue({ researchRunId: run.id, onProgress });
    if (result.status === "partial" && this.enqueueResearch) {
      try { await this.enqueueResearch(run.id); }
      catch {
        await this.repositories.research.updateRun(run.id, { status: "failed", completedAt: new Date().toISOString() });
        return { ...result, status: "failed", message: "Durable research continuation could not be queued." };
      }
    }
    return result;
  }

  private async discoverMore(run: ResearchRun): Promise<{ run: ResearchRun; error?: string }> {
    if (!this.discovery) return { run, error: "Research provider is unavailable." };
    const existing = await this.repositories.research.listCandidates(run.id);
    const used = Number(run.config.discoveryQueriesUsed ?? 0);
    const totalUsed = Number(run.config.totalQueriesUsed ?? 0);
    const maxQueries = Number(run.config.maxDiscoveryQueries ?? 1);
    const totalCap = Number(run.config.maxSearchQueries ?? 1);
    const maxCandidates = Number(run.config.maxCandidates ?? run.requestedLimit);
    if (used >= maxQueries || totalUsed >= totalCap || existing.length >= maxCandidates) return { run: await this.repositories.research.updateRun(run.id, { config: { ...run.config, discoveryComplete: true } }) };
    const focuses = [
      `${run.industry} ${run.location}`,
      `επαγγελματικός κατάλογος ${run.industry} ${run.location}`,
      `${run.industry} ${run.location} τοπικές επιχειρήσεις`,
      `business directory ${run.industry} ${run.location}`,
    ];
    const discovery = await this.discovery.discover({ industry: run.industry, location: run.location, limit: Math.min(20, maxCandidates - existing.length), criteria: run.config.criteria as Record<string, unknown> | undefined, searchFocus: focuses[used % focuses.length] });
    if (this.mode === "live" && !discovery.searched) return { run, error: discovery.error ?? "Live business discovery failed." };
    const existingKeys = new Set(existing.map((candidate) => candidate.normalizedKey));
    const fresh = deduplicateCandidates(discovery.businesses).filter((candidate) => !existingKeys.has(candidateIdentityKey(candidate))).slice(0, maxCandidates - existing.length);
    if (fresh.length) await this.repositories.research.addCandidates(run.id, fresh.map((candidate) => ({ businessName: candidate.businessName, normalizedKey: candidateIdentityKey(candidate), industry: candidate.industry, location: candidate.location, officialWebsite: candidate.officialWebsite, phone: candidate.phone, email: candidate.email, status: "discovered", sourceResults: candidate.sources })));
    const all = await this.repositories.research.listCandidates(run.id);
    const nextUsed = used + 1;
    return { run: await this.repositories.research.updateRun(run.id, { discoveredCount: all.length, config: { ...run.config, discoveryQueriesUsed: nextUsed, totalQueriesUsed: totalUsed + 1, discoveryComplete: nextUsed >= maxQueries || totalUsed + 1 >= totalCap || all.length >= maxCandidates } }) };
  }

  async continue({ researchRunId, onProgress }: { researchRunId: string; onProgress?: (progress: ResearchProgress) => Promise<void> | void }): Promise<ResearchBatchResult> {
    const storedRun = await this.repositories.research.getRun(researchRunId);
    if (!storedRun) return { researchRunId, status: "failed", discoveredCount: 0, verifiedCount: 0, analyzedCount: 0, qualifiedCount: 0, failedCount: 1, processedCount: 0, message: "Research run was not found.", leads: [] };
    let run: ResearchRun = storedRun;
    if (run.status === "cancelled") return { ...this.counts(run), researchRunId, status: "cancelled", message: "Research was cancelled. Completed evidence was preserved.", leads: [] };
    if (run.status === "failed" || run.status === "completed") return { ...this.counts(run), researchRunId, status: run.status, message: `Research is ${run.status}.`, leads: [] };
    if (run.status === "partial") run = await this.repositories.research.claimContinuation(researchRunId);
    let pending = await this.repositories.research.listPendingCandidates(researchRunId, 5);
    if (!pending.length && run.qualifiedCount < run.requestedLimit && !run.config.discoveryComplete) {
      const discovery = await this.discoverMore(run);
      if (discovery.error) { run = await this.repositories.research.updateRun(run.id, { status: "failed", completedAt: new Date().toISOString() }); return { ...this.counts(run), researchRunId, status: "failed", message: discovery.error, leads: [] }; }
      run = discovery.run;
      pending = await this.repositories.research.listPendingCandidates(researchRunId, 5);
    }
    const settings = await this.repositories.settings.get();
    const concurrency = this.mode === "live" ? 1 : configuredLimit("RESEARCH_MAX_CONCURRENCY", settings.researchMaxConcurrency, 1, 5);
    const qualifiedLeads: Lead[] = [];
    for (let index = 0; index < pending.length; index += concurrency) {
      const batch = pending.slice(index, index + concurrency);
      await Promise.all(batch.map(async (candidate) => {
        const current = (await this.repositories.research.getRun(researchRunId)) ?? run;
        if (current.status === "cancelled") return;
        await onProgress?.({ researchRunId, status: "running", description: `Researching ${candidate.businessName} · ${current.processedCount + 1}/${current.discoveredCount}`, processed: current.processedCount, total: current.discoveredCount, metadata: { candidateId: candidate.id } });
        try { const lead = await this.processCandidate(current, candidate); if (lead?.status === "qualified") qualifiedLeads.push(lead); }
        catch { await this.repositories.research.updateCandidate(candidate.id, { status: "failed", error: "Candidate research failed safely." }); }
      }));
      run = await this.recount(researchRunId);
      await onProgress?.({ researchRunId, status: "running", description: `Persisted progress · ${run.processedCount}/${run.discoveredCount} candidates processed.`, processed: run.processedCount, total: run.discoveredCount });
    }
    run = await this.recount(researchRunId);
    const remaining = await this.repositories.research.listPendingCandidates(researchRunId, 1);
    const status = run.status === "cancelled" ? "cancelled" : run.qualifiedCount >= run.requestedLimit || (!remaining.length && run.config.discoveryComplete) ? "completed" : "partial";
    run = await this.repositories.research.updateRun(researchRunId, { status, completedAt: status === "completed" || status === "cancelled" ? new Date().toISOString() : null });
    const languageGreek = /[Α-ω]/u.test(run.query);
    const message = status === "partial" ? `Research progress saved: ${run.processedCount}/${run.discoveredCount} candidates processed. The next batch can resume safely.` : status === "cancelled" ? "Research cancelled. Completed research and evidence were preserved." : languageGreek ? `Η έρευνα ολοκληρώθηκε. ${run.discoveredCount} μοναδικές επιχειρήσεις, ${run.verifiedCount} επαληθευμένες, ${run.analyzedCount} αναλυμένες και ${run.qualifiedCount} qualified leads.` : `Research completed. ${run.discoveredCount} unique businesses, ${run.verifiedCount} verified, ${run.analyzedCount} analyzed, and ${run.qualifiedCount} qualified leads.`;
    const citedLeads = await Promise.all(qualifiedLeads.map(async (lead) => {
      const [sources, evidence] = await Promise.all([this.repositories.evidence.listSourcesForLead(lead.id), this.repositories.evidence.listEvidenceForLead(lead.id)]);
      const storedStatus = evidence.find((item) => item.fieldName === "website_status")?.valueText;
      const websiteStatus: WebsiteVerificationStatus = storedStatus === "VERIFIED_WEBSITE" || storedStatus === "NO_OFFICIAL_SITE_FOUND" || storedStatus === "UNCERTAIN" ? storedStatus : "UNRESEARCHED";
      return { ...compactLead(lead), websiteStatus, sourceUrls: [...new Set(sources.map((source) => source.sourceUrl))].slice(0, 15) };
    }));
    return { ...this.counts(run), researchRunId, status, message, leads: citedLeads };
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
    const testOnly = (run.config.criteria as Record<string, unknown> | undefined)?.testOnly === true;
    let websiteStatus: WebsiteVerificationStatus = "UNRESEARCHED";
    let verificationReason = "Website verification has not run.";
    let analysis: Omit<WebsiteAnalysis, "id" | "retrievedAt">;
    if (this.mode === "demo") {
      analysis = this.demoAnalysis(candidate);
    } else if (this.web && this.fetcher && this.analyzer) {
      const remainingQueries = Math.max(0, Number(run.config.maxSearchQueries ?? 1) - Number(run.config.totalQueriesUsed ?? 0));
      const verified = await verifyOfficialWebsite(candidate, this.web, remainingQueries);
      websiteStatus = verified.status;
      verificationReason = verified.reason;
      const mergedSources = [...candidate.sourceResults];
      for (const item of verified.sources) if (!mergedSources.some((source) => source.url === item.url)) mergedSources.push(item);
      candidate = await this.repositories.research.updateCandidate(candidate.id, { sourceResults: mergedSources.slice(0, 25), officialWebsite: null });
      run = await this.repositories.research.updateRun(run.id, { config: { ...run.config, totalQueriesUsed: Number(run.config.totalQueriesUsed ?? 0) + verified.checkedQueries } });
      if (verified.officialWebsite) {
        const fetched = await this.fetcher.fetchSite(verified.officialWebsite, { maxPages: configuredLimit("RESEARCH_MAX_PAGES_PER_SITE", settings.researchMaxPagesPerSite, 1, 5), timeoutMs: configuredLimit("RESEARCH_FETCH_TIMEOUT_MS", settings.researchFetchTimeoutMs, 2_000, 20_000) });
        // Persisted lead claims and scores use deterministic page signals only.
        // Untrusted page prose never becomes a model-authored instruction or tool command.
        const inspected = await this.analyzer.analyze({ websiteUrl: verified.officialWebsite, pages: fetched.pages, enableAi: false, candidateId: candidate.id });
        if (fetched.pages.length && websiteIdentityMatches(candidate.businessName, `${inspected.title ?? ""} ${inspected.visibleText}`, candidate.location)) {
          websiteStatus = "VERIFIED_WEBSITE";
          verificationReason = "Cited domain was reachable and matched the business identity on an inspected page.";
          candidate = await this.repositories.research.updateCandidate(candidate.id, { officialWebsite: verified.officialWebsite });
          analysis = inspected;
        } else {
          websiteStatus = "UNCERTAIN";
          verificationReason = "A possible domain was found, but reachability or business identity could not be confirmed.";
          analysis = this.unknownAnalysis(candidate);
        }
      } else analysis = this.unknownAnalysis(candidate);
    } else analysis = this.unknownAnalysis(candidate);
    const primaryUrl = candidate.officialWebsite ?? candidate.sourceResults[0]?.url;
    if (!primaryUrl) throw new Error("Candidate has no cited public source");
    const source = await this.repositories.evidence.addSource({ leadId: null, researchRunId: run.id, candidateId: candidate.id, sourceType: candidate.officialWebsite ? "official_website" : "search_result", sourceUrl: primaryUrl, title: candidate.sourceResults[0]?.title ?? candidate.businessName, provider: this.discovery?.name ?? "unknown", metadata: { fictional: this.mode === "demo", testOnly, provisional: true, sourceCount: candidate.sourceResults.length, websiteStatus, verificationReason, observedAt: new Date().toISOString() } });
    const sourceIds = [source.id];
    const preliminary = this.score(candidate, analysis, sourceIds, websiteStatus);
    const existing = await this.findExistingLead(candidate);
    if (testOnly && existing) { await this.repositories.research.updateCandidate(candidate.id, { status: "analyzed", leadId: existing.id }); return null; }
    if (preliminary.score < settings.minimumLeadScore && !existing) { if (candidate.officialWebsite) await this.repositories.evidence.addWebsiteAnalysis(analysis); await this.repositories.research.updateCandidate(candidate.id, { status: "analyzed" }); return null; }
    const leadInput = { businessName: candidate.businessName, category: candidate.industry, city: candidate.location, country: "Unknown", website: candidate.officialWebsite, email: analysis.email ?? candidate.email, phone: analysis.phone ?? candidate.phone, source: this.mode === "demo" ? "demo" as const : "provider" as const, status: preliminary.score >= settings.minimumLeadScore ? "qualified" as const : "analyzed" as const, score: preliminary.score, scoreReason: preliminary.reasons.join(" ") || "Evidence was insufficient for opportunity scoring.", opportunitySummary: `${testOnly ? "[TEST RESEARCH] " : ""}${analysis.opportunities[0] ?? analysis.digitalGaps[0] ?? "Research completed; opportunity remains Unknown."}`, reviewCount: null, scoreComponents: preliminary.components, evidenceIds: preliminary.evidenceIds, researchConfidence: analysis.confidence, lastResearchedAt: new Date().toISOString() };
    let lead = existing ? await this.repositories.leads.update(existing.id, leadInput) : await this.repositories.leads.create(leadInput);
    const leadSources = await Promise.all(candidate.sourceResults.map((item) => this.repositories.evidence.addSource({ leadId: lead.id, researchRunId: run.id, candidateId: candidate.id, sourceType: candidate.officialWebsite && normalizedDomain(item.url) === normalizedDomain(candidate.officialWebsite) ? "official_website" : item.sourceType === "official_profile" || item.sourceType === "directory" ? item.sourceType : "search_result", sourceUrl: item.url, title: item.title, provider: this.discovery?.name ?? "unknown", metadata: { fictional: this.mode === "demo", testOnly, snippet: item.snippet, websiteStatus, observedAt: new Date().toISOString() } })));
    const evidence = await this.persistLeadEvidence(lead.id, leadSources[0]?.id ?? source.id, candidate, analysis);
    const websiteEvidence = await this.repositories.evidence.addEvidence({ leadId: lead.id, sourceId: leadSources[0]?.id ?? source.id, fieldName: "website_status", valueText: websiteStatus, confidence: websiteStatus === "VERIFIED_WEBSITE" ? "verified" : websiteStatus === "NO_OFFICIAL_SITE_FOUND" ? "medium" : "unknown", evidenceSummary: verificationReason, verifiedAt: websiteStatus === "VERIFIED_WEBSITE" ? new Date().toISOString() : null });
    const finalScore = this.score(candidate, analysis, [...evidence, websiteEvidence], websiteStatus);
    lead = await this.repositories.leads.update(lead.id, { score: finalScore.score, status: finalScore.score >= settings.minimumLeadScore ? "qualified" : "analyzed", scoreReason: finalScore.reasons.join(" ") || "Evidence was insufficient for opportunity scoring.", scoreComponents: finalScore.components, evidenceIds: finalScore.evidenceIds, researchConfidence: analysis.confidence, lastResearchedAt: new Date().toISOString() });
    if (candidate.officialWebsite) await this.repositories.evidence.addWebsiteAnalysis({ ...analysis, leadId: lead.id });
    await this.repositories.research.updateCandidate(candidate.id, { status: lead.status === "qualified" ? "qualified" : "analyzed", leadId: lead.id, phone: lead.phone, email: lead.email });
    await this.repositories.activity.create({ eventType: "score", title: `Lead scored ${lead.score}/100`, description: lead.businessName, metadata: { leadId: lead.id, researchRunId: run.id } });
    return lead;
  }

  private score(candidate: ResearchCandidate, analysis: Omit<WebsiteAnalysis, "id" | "retrievedAt">, evidence: string[] | LeadEvidence[], websiteStatus: WebsiteVerificationStatus = "UNRESEARCHED") {
    const fallbackIds = typeof evidence[0] === "string" ? evidence as string[] : [];
    const idsFor = (...fields: string[]) => Array.isArray(evidence) && typeof evidence[0] !== "string" ? (evidence as LeadEvidence[]).filter((item) => fields.includes(item.fieldName)).map((item) => item.id) : fallbackIds;
    const identityIds = idsFor("business_identity"); const locationIds = idsFor("location"); const contactIds = idsFor("contact_path"); const websiteIds = idsFor("website", "online_booking", "clear_cta", "mobile_viewport");
    const websiteStatusIds = idsFor("website_status");
    const confidence = analysis.confidence;
    return scoreLeadV2({
      serviceFit: fact(true, candidate.sourceResults.length ? "medium" : "unknown", identityIds),
      targetGeography: fact(true, candidate.sourceResults.length ? "medium" : "unknown", locationIds),
      activeBusiness: fact(candidate.sourceResults.length > 0, candidate.sourceResults.length > 1 ? "high" : "medium", identityIds),
      contactable: fact(analysis.hasEmail || analysis.hasPhone || Boolean(candidate.email || candidate.phone), candidate.email || candidate.phone ? "medium" : confidence, contactIds),
      websiteQuality: fact(analysis.digitalGaps.length ? "needs_work" : analysis.status === "completed" ? "strong" : null, confidence, websiteIds),
      websiteStatus: fact(websiteStatus, websiteStatus === "NO_OFFICIAL_SITE_FOUND" ? "medium" : websiteStatus === "VERIFIED_WEBSITE" ? "verified" : "unknown", websiteStatusIds),
      mobileBasics: fact(analysis.hasViewportMeta === null ? null : analysis.hasViewportMeta ? "strong" : "poor", confidence, idsFor("mobile_viewport")),
      booking: fact(analysis.hasBooking === null ? null : analysis.hasBooking ? "available" : "missing", confidence, idsFor("online_booking")),
      clearCta: fact(analysis.hasClearCta, confidence, idsFor("clear_cta")),
    });
  }

  private async persistLeadEvidence(leadId: string, sourceId: string, candidate: ResearchCandidate, analysis: Omit<WebsiteAnalysis, "id" | "retrievedAt">) { const claims = [{ fieldName: "business_identity", valueText: candidate.businessName, confidence: candidate.officialWebsite ? "high" as const : "medium" as const, summary: `Business identity supported by ${candidate.sourceResults.length} public source(s).` }, { fieldName: "location", valueText: candidate.location, confidence: "medium" as const, summary: "Location reported by public business research." }, { fieldName: "website", valueText: candidate.officialWebsite ?? "Unknown", confidence: candidate.officialWebsite ? "verified" as const : "unknown" as const, summary: candidate.officialWebsite ? "Official website identity matched." : "No official website was confidently identified." }, { fieldName: "contact_path", valueText: analysis.email ?? analysis.phone ?? candidate.email ?? candidate.phone ?? "Unknown", confidence: analysis.email || analysis.phone || candidate.email || candidate.phone ? analysis.confidence : "unknown" as const, summary: analysis.email || analysis.phone ? "Public contact path detected on analyzed pages." : "No public contact path was verified." }, { fieldName: "mobile_viewport", valueText: analysis.hasViewportMeta === null ? "Unknown" : analysis.hasViewportMeta ? "Detected" : "Not detected on analyzed pages", confidence: analysis.confidence, summary: analysis.hasViewportMeta === null ? "Website unavailable; mobile viewport remains Unknown." : `${analysis.pagesAnalyzed.length} page(s) analyzed.` }, { fieldName: "online_booking", valueText: analysis.hasBooking === null ? "Unknown" : analysis.hasBooking ? "Detected" : "Not detected on analyzed pages", confidence: analysis.confidence, summary: analysis.hasBooking === null ? "Website unavailable; booking remains Unknown." : `${analysis.pagesAnalyzed.length} page(s) analyzed.` }, { fieldName: "clear_cta", valueText: analysis.hasClearCta === null ? "Unknown" : analysis.hasClearCta ? "Detected" : "Not detected on analyzed pages", confidence: analysis.confidence, summary: `${analysis.pagesAnalyzed.length} page(s) analyzed.` }]; return Promise.all(claims.map((claim) => this.repositories.evidence.addEvidence({ leadId, sourceId, fieldName: claim.fieldName, valueText: claim.valueText, confidence: claim.confidence, evidenceSummary: claim.summary, verifiedAt: claim.confidence === "verified" ? new Date().toISOString() : null }))); }

  private async findExistingLead(candidate: ResearchCandidate) { const leads = await this.repositories.leads.list(); const domain = normalizedDomain(candidate.officialWebsite); const phone = candidate.phone?.replace(/\D/g, ""); const nameLocation = normalizedNameLocation(candidate.businessName, candidate.location); return leads.find((lead) => domain && normalizedDomain(lead.website) === domain || phone && phone.length >= 8 && lead.phone?.replace(/\D/g, "") === phone || normalizedNameLocation(lead.businessName, lead.city) === nameLocation) ?? null; }
  private demoAnalysis(candidate: ResearchCandidate): Omit<WebsiteAnalysis, "id" | "retrievedAt"> { const hasSite = Boolean(candidate.officialWebsite); return { leadId: null, candidateId: candidate.id, websiteUrl: candidate.officialWebsite ?? candidate.sourceResults[0]?.url, status: hasSite ? "completed" : "failed", title: hasSite ? `${candidate.businessName} · fictional demo` : null, metaDescription: null, language: "en", hasViewportMeta: hasSite ? false : null, hasContactForm: hasSite ? false : null, hasBooking: hasSite ? false : null, hasClearCta: hasSite ? false : null, hasPhone: candidate.phone ? true : hasSite ? false : null, hasEmail: candidate.email ? true : hasSite ? false : null, hasHttps: hasSite, phone: candidate.phone, email: candidate.email, pagesAnalyzed: hasSite ? [candidate.officialWebsite!] : [], visibleText: "Fictional demo evidence only.", strengths: [], digitalGaps: hasSite ? ["Fictional demo: no booking path or clear CTA in seeded signals."] : [], opportunities: hasSite ? ["Fictional demo opportunity: improve the conversion journey."] : [], unknowns: hasSite ? [] : ["Website is Unknown in the fictional dataset."], confidence: hasSite ? "medium" : "unknown" }; }
  private unknownAnalysis(candidate: ResearchCandidate): Omit<WebsiteAnalysis, "id" | "retrievedAt"> { return { leadId: null, candidateId: candidate.id, websiteUrl: candidate.officialWebsite ?? candidate.sourceResults[0]?.url, status: "failed", title: null, metaDescription: null, language: null, hasViewportMeta: null, hasContactForm: null, hasBooking: null, hasClearCta: null, hasPhone: null, hasEmail: null, hasHttps: Boolean(candidate.officialWebsite?.startsWith("https:")), phone: candidate.phone, email: candidate.email, pagesAnalyzed: [], visibleText: "", strengths: [], digitalGaps: [], opportunities: [], unknowns: ["No official website was confidently identified or fetched."], confidence: "unknown" }; }
  private async recount(id: string) { const run = await this.repositories.research.getRun(id); if (!run) throw new Error("Research run not found"); const candidates = await this.repositories.research.listCandidates(id); const processed = candidates.filter((item) => item.status !== "discovered"); return this.repositories.research.updateRun(id, { verifiedCount: candidates.filter((item) => Boolean(item.officialWebsite)).length, analyzedCount: candidates.filter((item) => item.status === "analyzed" || item.status === "qualified").length, qualifiedCount: candidates.filter((item) => item.status === "qualified").length, failedCount: candidates.filter((item) => item.status === "failed").length, processedCount: processed.length }); }
  private counts(run: NonNullable<Awaited<ReturnType<Repositories["research"]["getRun"]>>>) { return { discoveredCount: run.discoveredCount, verifiedCount: run.verifiedCount, analyzedCount: run.analyzedCount, qualifiedCount: run.qualifiedCount, failedCount: run.failedCount, processedCount: run.processedCount }; }
  private emptyCounts() { return { discoveredCount: 0, verifiedCount: 0, analyzedCount: 0, qualifiedCount: 0, failedCount: 0, processedCount: 0 }; }
  private unavailable(): ResearchBatchResult { return { researchRunId: "", status: "failed", discoveredCount: 0, verifiedCount: 0, analyzedCount: 0, qualifiedCount: 0, failedCount: 0, processedCount: 0, message: "Live web research is not configured.", leads: [] }; }
}
