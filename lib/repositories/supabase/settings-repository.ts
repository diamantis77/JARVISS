import type { SettingsRepository } from "@/lib/repositories/contracts";
import type { BusinessSettings } from "@/types";
import { assertResult, type DbClient } from "./shared";

export class SupabaseSettingsRepository implements SettingsRepository {
  constructor(private readonly db: DbClient, private readonly userId: string) {}
  async get(): Promise<BusinessSettings> {
    const [{ data: settings, error }, { data: profile, error: profileError }] = await Promise.all([this.db.from("settings").select("*").eq("user_id", this.userId).maybeSingle(), this.db.from("profiles").select("*").eq("id", this.userId).maybeSingle()]);
    if (error || profileError) throw new Error("Unable to load settings");
    return { userId: this.userId, fullName: String(profile?.full_name ?? ""), businessName: String(profile?.company_name ?? ""), defaultLanguage: String(settings?.default_language ?? "en"), targetIndustries: (settings?.target_industries as string[] | null) ?? [], targetLocations: (settings?.target_locations as string[] | null) ?? [], minimumLeadScore: Number(settings?.minimum_lead_score ?? 70), companyServices: (settings?.company_services as string[] | null) ?? [], companyDescription: String(settings?.company_description ?? ""), researchMaxLeads: Number(settings?.research_max_leads ?? 20), researchMaxPagesPerSite: Number(settings?.research_max_pages_per_site ?? 5), researchFetchTimeoutMs: Number(settings?.research_fetch_timeout_ms ?? 8000), researchMaxConcurrency: Number(settings?.research_max_concurrency ?? 2), researchAiAnalysisEnabled: Boolean(settings?.research_ai_analysis_enabled ?? true), jarvisVoice: (settings?.jarvis_voice as BusinessSettings["jarvisVoice"]) ?? "marin", voiceMode: (settings?.voice_mode as BusinessSettings["voiceMode"]) ?? "conversation", timezone: String(settings?.timezone ?? "Europe/Athens") };
  }
  async upsert(input: Omit<BusinessSettings, "userId">) {
    const profileResult = await this.db.from("profiles").upsert({ id: this.userId, full_name: input.fullName, company_name: input.businessName }); if (profileResult.error) throw new Error("Unable to save profile");
    const { data, error } = await this.db.from("settings").upsert({ user_id: this.userId, default_language: input.defaultLanguage, target_industries: input.targetIndustries, target_locations: input.targetLocations, minimum_lead_score: input.minimumLeadScore, company_services: input.companyServices, company_description: input.companyDescription, research_max_leads: input.researchMaxLeads, research_max_pages_per_site: input.researchMaxPagesPerSite, research_fetch_timeout_ms: input.researchFetchTimeoutMs, research_max_concurrency: input.researchMaxConcurrency, research_ai_analysis_enabled: input.researchAiAnalysisEnabled, jarvis_voice: input.jarvisVoice, voice_mode: input.voiceMode, timezone: input.timezone }).select().single(); assertResult(data, error, "settings.upsert"); return this.get();
  }
}
