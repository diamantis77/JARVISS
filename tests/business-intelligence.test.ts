import { describe, expect, it } from "vitest";
import { aggregateBusinessIntelligence, formatEur, resolveStageProbability } from "../lib/business-intelligence";
import type { Lead } from "../types";

function lead(overrides: Partial<Lead>): Lead {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    businessName: "Δοκιμαστική επιχείρηση",
    category: "Υπηρεσίες",
    city: "Κως",
    country: "Ελλάδα",
    website: null,
    email: null,
    phone: null,
    source: "provider",
    status: "new",
    score: 70,
    scoreReason: "Test",
    opportunitySummary: "Test",
    reviewCount: null,
    lastActivity: "2026-09-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("business intelligence aggregations", () => {
  it("calculates open pipeline and probability-weighted revenue deterministically", () => {
    const summary = aggregateBusinessIntelligence([
      lead({ id: "proposal", estimatedValue: 1_000, dealStage: "proposal" }),
      lead({ id: "negotiation", estimatedValue: 2_000, dealStage: "negotiation", stageProbability: .9 }),
      lead({ id: "won", estimatedValue: 500, actualRevenue: 450, dealStage: "won", status: "won" }),
      lead({ id: "lost", estimatedValue: 5_000, dealStage: "lost", status: "lost" }),
    ]);

    expect(summary.pipelineValue).toBe(3_000);
    expect(summary.expectedRevenue).toBe(2_500);
    expect(summary.closedRevenue).toBe(450);
    expect(summary.openProposals).toBe(2);
    expect(summary.potentialDeals).toBe(2);
    expect(summary.closeToClosing.map((item) => item.id)).toEqual(["negotiation", "proposal"]);
  });

  it("uses stable stage defaults and clamps explicit probabilities", () => {
    expect(resolveStageProbability(lead({ dealStage: "qualified" }))).toBe(.25);
    expect(resolveStageProbability(lead({ dealStage: "proposal", stageProbability: 3 }))).toBe(1);
    expect(resolveStageProbability(lead({ dealStage: "proposal", stageProbability: -.5 }))).toBe(0);
  });

  it("never invents financial metrics when structured values are absent", () => {
    const summary = aggregateBusinessIntelligence([lead({ status: "qualified" })]);
    expect(summary.hasFinancialData).toBe(false);
    expect(summary.pipelineValue).toBeNull();
    expect(summary.expectedRevenue).toBeNull();
    expect(summary.closedRevenue).toBeNull();
    expect(formatEur(summary.pipelineValue)).toBe("Δεν υπάρχουν αρκετά δεδομένα");
  });

  it("does not silently convert or sum non-EUR values into EUR metrics", () => {
    const summary = aggregateBusinessIntelligence([lead({ estimatedValue: 8_000, currency: "USD", dealStage: "proposal" })]);
    expect(summary.hasFinancialData).toBe(false);
    expect(summary.pipelineValue).toBeNull();
    expect(summary.expectedRevenue).toBeNull();
  });

  it("formats real values in Greek EUR notation", () => {
    expect(formatEur(1_250)).toMatch(/1\.250/);
    expect(formatEur(1_250)).toContain("€");
  });
});
