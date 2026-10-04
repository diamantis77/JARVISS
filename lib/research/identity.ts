import type { DiscoveredBusiness } from "./contracts";

function clean(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\p{L}]+/gu, " ").trim();
}
export function normalizedNameLocation(name: string, location: string) { return `${clean(name)}|${clean(location)}`; }

export function normalizedDomain(value: string | null | undefined) {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

export function candidateIdentityKey(candidate: Pick<DiscoveredBusiness, "businessName" | "location" | "officialWebsite" | "phone">) {
  const domain = normalizedDomain(candidate.officialWebsite);
  if (domain) return `domain:${domain}`;
  const phone = candidate.phone?.replace(/\D/g, "");
  if (phone && phone.length >= 8) return `phone:${phone}`;
  return `name-location:${normalizedNameLocation(candidate.businessName, candidate.location)}`;
}

export function deduplicateCandidates(candidates: DiscoveredBusiness[]) {
  const unique: DiscoveredBusiness[] = [];
  const byStrongIdentity = new Map<string, number>();
  for (const candidate of candidates) {
    const key = candidateIdentityKey(candidate);
    const existingIndex = byStrongIdentity.get(key);
    if (existingIndex === undefined) {
      byStrongIdentity.set(key, unique.length);
      unique.push({ ...candidate, sources: [...candidate.sources] });
      continue;
    }
    const existing = unique[existingIndex];
    const sources = [...existing.sources];
    for (const source of candidate.sources) if (!sources.some((item) => item.url === source.url)) sources.push(source);
    unique[existingIndex] = {
      ...existing,
      officialWebsite: existing.officialWebsite ?? candidate.officialWebsite,
      phone: existing.phone ?? candidate.phone,
      email: existing.email ?? candidate.email,
      confidence: existing.confidence === "verified" || candidate.confidence !== "verified" ? existing.confidence : "verified",
      sources,
    };
  }
  return unique;
}
