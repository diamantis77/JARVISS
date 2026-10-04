import type { DealStage, Lead } from "../types";

export const STAGE_ORDER: DealStage[] = ["new", "analyzed", "qualified", "contacted", "interested", "proposal", "negotiation", "won"];
export const DEFAULT_STAGE_PROBABILITIES: Record<DealStage, number> = { new: .10, analyzed: .15, qualified: .25, contacted: .35, interested: .55, proposal: .70, negotiation: .85, won: 1, lost: 0 };

export type PipelineStageSummary = { stage: DealStage; count: number; value: number | null };
export type BusinessFinancialSummary = {
  hasFinancialData: boolean;
  pipelineValue: number | null;
  expectedRevenue: number | null;
  closedRevenue: number | null;
  openProposals: number;
  potentialDeals: number;
  stages: PipelineStageSummary[];
  closeToClosing: Lead[];
};

export function resolveDealStage(lead: Lead): DealStage {
  if (lead.dealStage) return lead.dealStage;
  if (lead.status === "meeting") return "interested";
  return lead.status;
}

export function resolveStageProbability(lead: Lead) {
  const explicit = lead.stageProbability;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return Math.min(1, Math.max(0, explicit));
  return DEFAULT_STAGE_PROBABILITIES[resolveDealStage(lead)];
}

function isEur(lead: Lead) {
  return !lead.currency || lead.currency.toUpperCase() === "EUR";
}

export function aggregateBusinessIntelligence(leads: Lead[]): BusinessFinancialSummary {
  const valued = leads.filter((lead) => isEur(lead) && typeof lead.estimatedValue === "number" && Number.isFinite(lead.estimatedValue) && lead.estimatedValue >= 0);
  const hasFinancialData = valued.length > 0 || leads.some((lead) => isEur(lead) && typeof lead.actualRevenue === "number" && Number.isFinite(lead.actualRevenue) && lead.actualRevenue >= 0);
  const open = valued.filter((lead) => !["won", "lost"].includes(resolveDealStage(lead)));
  const pipelineValue = hasFinancialData ? open.reduce((sum, lead) => sum + (lead.estimatedValue ?? 0), 0) : null;
  const expectedRevenue = hasFinancialData ? open.reduce((sum, lead) => sum + (lead.estimatedValue ?? 0) * resolveStageProbability(lead), 0) : null;
  const closedRows = leads.filter((lead) => isEur(lead) && resolveDealStage(lead) === "won" && typeof lead.actualRevenue === "number" && Number.isFinite(lead.actualRevenue) && lead.actualRevenue >= 0);
  const closedRevenue = closedRows.length ? closedRows.reduce((sum, lead) => sum + (lead.actualRevenue ?? 0), 0) : null;
  const openProposals = leads.filter((lead) => ["proposal", "negotiation"].includes(resolveDealStage(lead))).length;
  const potentialDeals = open.length;
  const stages = STAGE_ORDER.map((stage) => { const rows = leads.filter((lead) => resolveDealStage(lead) === stage); const withValue = rows.filter((lead) => isEur(lead) && typeof lead.estimatedValue === "number" && Number.isFinite(lead.estimatedValue) && lead.estimatedValue >= 0); return { stage, count: rows.length, value: withValue.length ? withValue.reduce((sum, lead) => sum + (lead.estimatedValue ?? 0), 0) : null }; });
  const closeToClosing = leads.filter((lead) => ["proposal", "negotiation"].includes(resolveDealStage(lead))).sort((a, b) => resolveStageProbability(b) - resolveStageProbability(a) || b.score - a.score).slice(0, 4);
  return { hasFinancialData, pipelineValue, expectedRevenue, closedRevenue, openProposals, potentialDeals, stages, closeToClosing };
}

export function formatEur(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Δεν υπάρχουν αρκετά δεδομένα";
  return new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}
