import type { BusinessDiscoveryProvider, WebResearchProvider } from "./contracts";

const fictional = [
  { businessName: "Helios Dental Studio", officialWebsite: "https://helios-dental.example", phone: "+30 210 555 0101", email: "hello@helios-dental.example" },
  { businessName: "Aegean Care Clinic", officialWebsite: "https://aegean-care.example", phone: null, email: "care@aegean-care.example" },
  { businessName: "Northstar Health Practice", officialWebsite: null, phone: "+30 2242 555 010", email: null },
  { businessName: "Olive Grove Medical", officialWebsite: "https://olive-medical.example", phone: null, email: null },
  { businessName: "Arcadia Wellness Center", officialWebsite: null, phone: null, email: null },
];

export class DemoResearchProvider implements WebResearchProvider, BusinessDiscoveryProvider {
  readonly name = "fictional-demo-research";
  async searchWeb({ query, maxResults }: { query: string; location?: string; maxResults: number }) { return { results: fictional.slice(0, maxResults).map((item) => ({ title: `${item.businessName} · fictional demo`, url: item.officialWebsite ?? `https://${item.businessName.toLowerCase().replace(/[^a-z]+/g, "-")}.example`, snippet: `Fictional demo result for ${query}. No live web search occurred.`, sourceType: "search_result" as const })) }; }
  async discover({ industry, location, limit }: { industry: string; location: string; limit: number }) { return { searched: false, businesses: fictional.slice(0, limit).map((item) => ({ ...item, industry, location, confidence: item.officialWebsite ? "medium" as const : "unknown" as const, sources: [{ title: `${item.businessName} · fictional demo`, url: item.officialWebsite ?? `https://${item.businessName.toLowerCase().replace(/[^a-z]+/g, "-")}.example`, snippet: "Fictional seeded candidate. No live search occurred.", sourceType: "search_result" as const }] })) }; }
}
