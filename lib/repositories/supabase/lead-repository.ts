import type { LeadRepository } from "../contracts";
import type { Lead } from "../../../types";
import { assertResult, mapLead, type DbClient } from "./shared";

export class SupabaseLeadRepository implements LeadRepository {
  constructor(private readonly db: DbClient, private readonly userId: string) {}
  async list() { const { data, error } = await this.db.from("leads").select("*").eq("user_id", this.userId).order("score", { ascending: false }); return assertResult(data, error, "leads.list").map(mapLead); }
  async getById(id: string) { const { data, error } = await this.db.from("leads").select("*").eq("user_id", this.userId).eq("id", id).maybeSingle(); if (error) throw new Error("Unable to read lead"); return data ? mapLead(data) : null; }
  async create(input: Omit<Lead, "id" | "lastActivity">) {
    const row = { user_id: this.userId, business_name: input.businessName, category: input.category, city: input.city, country: input.country, website: input.website, email: input.email, phone: input.phone, source: input.source, status: input.status, score: input.score, score_reason: input.scoreReason, opportunity_summary: input.opportunitySummary, review_count: input.reviewCount, score_components: input.scoreComponents ?? [], evidence_ids: input.evidenceIds ?? [], research_confidence: input.researchConfidence ?? "unknown", last_researched_at: input.lastResearchedAt ?? null };
    const { data, error } = await this.db.from("leads").insert(row).select().single(); return mapLead(assertResult(data, error, "leads.create"));
  }
  async update(id: string, patch: Parameters<LeadRepository["update"]>[1]) {
    const row: Record<string, unknown> = {};
    const keys: Array<[keyof typeof patch, string]> = [["businessName", "business_name"], ["category", "category"], ["city", "city"], ["country", "country"], ["website", "website"], ["email", "email"], ["phone", "phone"], ["status", "status"], ["score", "score"], ["scoreReason", "score_reason"], ["opportunitySummary", "opportunity_summary"], ["reviewCount", "review_count"], ["scoreComponents", "score_components"], ["evidenceIds", "evidence_ids"], ["researchConfidence", "research_confidence"], ["lastResearchedAt", "last_researched_at"]];
    keys.forEach(([key, column]) => { if (key in patch) row[column] = patch[key]; });
    const { data, error } = await this.db.from("leads").update(row).eq("user_id", this.userId).eq("id", id).select().single(); return mapLead(assertResult(data, error, "leads.update"));
  }
  async delete(id: string) { const { error } = await this.db.from("leads").delete().eq("user_id", this.userId).eq("id", id); if (error) throw new Error("Unable to delete lead"); }
  async search(query: string, limit = 10) { const term = query.replace(/[,_%]/g, " ").trim(); const base = this.db.from("leads").select("*").eq("user_id", this.userId).order("score", { ascending: false }).limit(limit); const { data, error } = term ? await base.or(`business_name.ilike.%${term}%,category.ilike.%${term}%,city.ilike.%${term}%`) : await base; return assertResult(data, error, "leads.search").map(mapLead); }
}
