import type { EmailProvider, LeadSearchProvider, VoiceProvider } from "./contracts";
import { demoLeads } from "@/lib/demo-data";

export const demoLeadSearchProvider: LeadSearchProvider = {
  async search({ category, location, limit }) {
    return demoLeads.filter((lead) => lead.category.toLowerCase().includes(category.toLowerCase()) || category.toLowerCase().includes("dent"))
      .map((lead) => ({ ...lead, city: location || lead.city, source: "demo" as const })).slice(0, limit);
  },
};

export const mockEmailProvider: EmailProvider = {
  async createDraft() { return { id: `draft_${crypto.randomUUID()}` }; },
  async send() { return { sent: false, reason: "Email provider not connected." }; },
};

export const demoVoiceProvider: VoiceProvider = {
  async startSession() {}, async stopSession() {}, async transcribe() { return ""; }, async speak() {},
};
