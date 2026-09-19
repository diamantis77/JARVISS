import type { InteractionRepository } from "@/lib/repositories/contracts";
import type { Interaction } from "@/types";
import { assertResult, type DbClient } from "./shared";

function mapInteraction(row: Record<string, unknown>): Interaction { return { id: String(row.id), leadId: String(row.lead_id), direction: row.direction === "inbound" ? "inbound" : "outbound", channel: (row.channel as Interaction["channel"]) ?? "note", subject: row.subject ? String(row.subject) : null, content: String(row.content ?? ""), status: String(row.status), createdAt: String(row.created_at) }; }

export class SupabaseInteractionRepository implements InteractionRepository {
  constructor(private readonly db: DbClient, private readonly userId: string) {}
  private async ownsLead(leadId: string) { const { data, error } = await this.db.from("leads").select("id").eq("user_id", this.userId).eq("id", leadId).maybeSingle(); if (error) throw new Error("Unable to verify lead ownership"); return Boolean(data); }
  async listForLead(leadId: string) { if (!await this.ownsLead(leadId)) return []; const { data, error } = await this.db.from("interactions").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }); return assertResult(data, error, "interactions.list").map(mapInteraction); }
  async create(input: Omit<Interaction, "id" | "createdAt">) { if (!await this.ownsLead(input.leadId)) throw new Error("Lead not found"); const { data, error } = await this.db.from("interactions").insert({ lead_id: input.leadId, direction: input.direction, channel: input.channel, subject: input.subject, content: input.content, status: input.status }).select().single(); return mapInteraction(assertResult(data, error, "interactions.create")); }
}
