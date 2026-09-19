export interface ScoreInput {
  hasWebsite: boolean | null;
  websiteQuality: "strong" | "needs_work" | "unknown";
  mobileQuality: "strong" | "poor" | "unknown";
  onlineBooking: "available" | "missing" | "unknown";
  reviewCount: number | null;
  professionalService: boolean;
}

export interface ScoreResult { score: number; reasons: string[]; evidence: string[] }

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
