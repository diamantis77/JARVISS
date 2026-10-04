export interface ScoreInput {
  hasWebsite: boolean | null;
  websiteQuality: "strong" | "needs_work" | "unknown";
  mobileQuality: "strong" | "poor" | "unknown";
  onlineBooking: "available" | "missing" | "unknown";
  reviewCount: number | null;
  professionalService: boolean;
}

export interface ScoreResult { score: number; reasons: string[]; evidence: string[] }

export interface EvidenceFact<T> { value: T | null; confidence: "verified" | "high" | "medium" | "low" | "unknown"; evidenceIds: string[] }
export interface ScoreV2Input {
  serviceFit: EvidenceFact<boolean>;
  targetGeography: EvidenceFact<boolean>;
  activeBusiness: EvidenceFact<boolean>;
  contactable: EvidenceFact<boolean>;
  websiteQuality: EvidenceFact<"strong" | "needs_work">;
  websiteStatus?: EvidenceFact<"NO_OFFICIAL_SITE_FOUND" | "VERIFIED_WEBSITE" | "UNCERTAIN" | "UNRESEARCHED">;
  mobileBasics: EvidenceFact<"strong" | "poor">;
  booking: EvidenceFact<"available" | "missing">;
  clearCta: EvidenceFact<boolean>;
}
export interface ScoreV2Result { score: number; reasons: string[]; components: Array<{ key: string; points: number; reason: string; evidenceIds: string[] }>; evidenceIds: string[] }

export function scoreLeadV2(input: ScoreV2Input): ScoreV2Result {
  const components: ScoreV2Result["components"] = [];
  const usable = <T>(fact: EvidenceFact<T>) => fact.value !== null && fact.confidence !== "unknown" && fact.evidenceIds.length > 0;
  const add = (key: string, points: number, reason: string, evidenceIds: string[]) => components.push({ key, points, reason, evidenceIds: [...new Set(evidenceIds)] });
  if (usable(input.serviceFit) && input.serviceFit.value === true) add("service_fit", 20, "Services match the target business type.", input.serviceFit.evidenceIds);
  if (usable(input.targetGeography) && input.targetGeography.value === true) add("target_geography", 15, "Business location matches the target geography.", input.targetGeography.evidenceIds);
  if (usable(input.activeBusiness) && input.activeBusiness.value === true) add("business_activity", 10, "Public evidence indicates an active business.", input.activeBusiness.evidenceIds);
  if (usable(input.contactable) && input.contactable.value === true) add("contactability", 10, "A public business contact path was verified.", input.contactable.evidenceIds);
  if (usable(input.websiteQuality) && input.websiteQuality.value === "needs_work") add("website_conversion", 20, "Analyzed pages show website conversion opportunities.", input.websiteQuality.evidenceIds);
  if (input.websiteStatus && usable(input.websiteStatus) && input.websiteStatus.value === "NO_OFFICIAL_SITE_FOUND") add("official_site_search_gap", 20, "No official site was found after the recorded name-and-location verification searches; absence is not asserted.", input.websiteStatus.evidenceIds);
  if (usable(input.mobileBasics) && input.mobileBasics.value === "poor") add("mobile_basics", 10, "A mobile viewport was not detected.", input.mobileBasics.evidenceIds);
  if (usable(input.booking) && input.booking.value === "missing") add("booking_gap", 10, "No obvious booking path was detected on analyzed pages.", input.booking.evidenceIds);
  if (usable(input.clearCta) && input.clearCta.value === false) add("cta_gap", 10, "No clear call-to-action was detected on analyzed pages.", input.clearCta.evidenceIds);
  return { score: Math.min(100, components.reduce((sum, component) => sum + component.points, 0)), reasons: components.map((component) => component.reason), components, evidenceIds: [...new Set(components.flatMap((component) => component.evidenceIds))] };
}

export function scoreLead(input: ScoreInput): ScoreResult {
  let score = input.professionalService ? 25 : 12;
  const reasons: string[] = [];
  const evidence: string[] = [];
  if (input.hasWebsite === false) { score += 30; reasons.push("No dedicated website"); evidence.push("Website availability: not found"); }
  if (input.websiteQuality === "needs_work") { score += 18; reasons.push("Website has visible conversion opportunities"); }
  if (input.mobileQuality === "poor") { score += 12; reasons.push("Mobile experience needs attention"); }
  if (input.onlineBooking === "missing") { score += 15; reasons.push("No online appointment path identified"); }
  if (input.reviewCount !== null) {
    evidence.push(`${input.reviewCount} public reviews reported by demo source`);
    if (input.reviewCount >= 75) { score += 12; reasons.push("Established local review presence"); }
  } else evidence.push("Review count: Unknown");
  return { score: Math.min(100, score), reasons, evidence };
}
