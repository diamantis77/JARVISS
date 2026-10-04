import type { DiscoveredBusiness, WebResearchProvider, WebSearchResult, WebsiteVerificationStatus } from "./contracts";
import { normalizedDomain } from "./identity";

const thirdPartyHosts = ["facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "youtube.com", "google.com", "google.gr", "tripadvisor.com", "booking.com", "doctoranytime.gr", "vrisko.gr", "xo.gr", "11888.gr", "yelp.com"];

export function isThirdPartyListing(url: string) {
  const host = normalizedDomain(url);
  return !host || thirdPartyHosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function clean(value: string) { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
export function websiteIdentityMatches(name: string, pageText: string, location = "") {
  const locationWords = new Set(clean(location).split(" "));
  const words = clean(name).split(" ").filter((word) => word.length >= 5 && !locationWords.has(word) && !["ιατρος", "γιατρος", "doctor", "clinic", "κλινικη", "αισθητικης"].includes(word));
  const page = clean(pageText).slice(0, 20_000);
  return words.length > 0 && words.some((word) => page.includes(word));
}

export interface WebsiteVerification {
  status: WebsiteVerificationStatus;
  officialWebsite: string | null;
  sources: WebSearchResult[];
  checkedQueries: number;
  reason: string;
}

export async function verifyOfficialWebsite(candidate: Pick<DiscoveredBusiness, "businessName" | "location" | "officialWebsite">, web: WebResearchProvider, maxQueries: number): Promise<WebsiteVerification> {
  if (maxQueries < 1) return { status: "UNRESEARCHED", officialWebsite: null, sources: [], checkedQueries: 0, reason: "Search budget was exhausted before website verification." };
  const queries = [`${candidate.businessName} ${candidate.location} επίσημη ιστοσελίδα`, `"${candidate.businessName}" ${candidate.location} website`];
  const sources: WebSearchResult[] = [];
  let checkedQueries = 0;
  let failed = false;
  for (const query of queries.slice(0, Math.min(2, maxQueries))) {
    const result = await web.searchWeb({ query, location: candidate.location, maxResults: 8 });
    checkedQueries += 1;
    if (result.error) { failed = true; continue; }
    for (const source of result.results) if (!sources.some((item) => item.url === source.url)) sources.push(source);
  }
  const candidateDomain = normalizedDomain(candidate.officialWebsite);
  const possible = sources.find((source) => !isThirdPartyListing(source.url) && (source.sourceType === "official_website" || candidateDomain && normalizedDomain(source.url) === candidateDomain));
  if (possible) return { status: "UNCERTAIN", officialWebsite: possible.url, sources, checkedQueries, reason: "A possible official domain was cited; page identity and reachability still require verification." };
  if (failed || checkedQueries < 2) return { status: "UNCERTAIN", officialWebsite: null, sources, checkedQueries, reason: "Official-site search was incomplete or unavailable." };
  return { status: "NO_OFFICIAL_SITE_FOUND", officialWebsite: null, sources, checkedQueries, reason: "Two name-and-location searches found no supported official domain; this is not proof that none exists." };
}
