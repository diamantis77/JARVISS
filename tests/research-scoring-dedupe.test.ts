import { describe, expect, it } from "vitest";
import { deduplicateCandidates } from "../lib/research/identity";
import { scoreLeadV2, type EvidenceFact, type ScoreV2Input } from "../lib/scoring";

const unknown = <T>(): EvidenceFact<T> => ({ value: null, confidence: "unknown", evidenceIds: [] });

describe("evidence-first scoring", () => {
  it("gives unknown or uncited claims zero points", () => {
    const input: ScoreV2Input = { serviceFit: { value: true, confidence: "high", evidenceIds: [] }, targetGeography: unknown(), activeBusiness: unknown(), contactable: unknown(), websiteQuality: unknown(), mobileBasics: unknown(), booking: unknown(), clearCta: unknown() };
    expect(scoreLeadV2(input)).toEqual({ score: 0, reasons: [], components: [], evidenceIds: [] });
  });

  it("is deterministic and retains evidence provenance", () => {
    const input: ScoreV2Input = { serviceFit: { value: true, confidence: "high", evidenceIds: ["e1"] }, targetGeography: { value: true, confidence: "medium", evidenceIds: ["e2"] }, activeBusiness: unknown(), contactable: unknown(), websiteQuality: { value: "needs_work", confidence: "high", evidenceIds: ["e3"] }, mobileBasics: unknown(), booking: { value: "missing", confidence: "high", evidenceIds: ["e3"] }, clearCta: unknown() };
    expect(scoreLeadV2(input)).toEqual(scoreLeadV2(input));
    expect(scoreLeadV2(input).score).toBe(65);
    expect(scoreLeadV2(input).evidenceIds).toEqual(["e1", "e2", "e3"]);
  });
});

describe("business identity deduplication", () => {
  const source = { title: "Source", url: "https://directory.example/a", snippet: "", sourceType: "directory" as const };
  it("merges strong matching domains while preserving combined sources", () => {
    const result = deduplicateCandidates([
      { businessName: "Alpha Clinic", industry: "Clinic", location: "Athens", officialWebsite: "https://www.alpha.example", phone: null, email: null, confidence: "high", sources: [source] },
      { businessName: "Alpha Medical", industry: "Clinic", location: "Athens", officialWebsite: "https://alpha.example/about", phone: null, email: "hi@alpha.example", confidence: "verified", sources: [{ ...source, url: "https://alpha.example" }] },
    ]);
    expect(result).toHaveLength(1); expect(result[0].email).toBe("hi@alpha.example"); expect(result[0].sources).toHaveLength(2);
  });

  it("keeps ambiguous similar names separate", () => {
    const result = deduplicateCandidates([
      { businessName: "Alpha Dental", industry: "Dentist", location: "Athens", officialWebsite: null, phone: null, email: null, confidence: "low", sources: [source] },
      { businessName: "Alpha Dental Center", industry: "Dentist", location: "Athens", officialWebsite: null, phone: null, email: null, confidence: "low", sources: [source] },
    ]);
    expect(result).toHaveLength(2);
  });
});
