import type { TaskRepository } from "@/lib/repositories/contracts";
import { assertResult, mapTask, type DbClient } from "./shared";

export class SupabaseTaskRepository implements TaskRepository {
  constructor(private readonly db: DbClient, private readonly userId: string) {}
  async list(status?: "open" | "completed") { let query = this.db.from("tasks").select("*").eq("user_id", this.userId).order("created_at", { ascending: false }); if (status) query = query.eq("status", status); const { data, error } = await query; return assertResult(data, error, "tasks.list").map(mapTask); }
  async create(input: { title: string; description?: string; leadId?: string; priority?: "high" | "medium" | "low"; dueAt?: string }) { if (input.leadId) { const { data, error } = await this.db.from("leads").select("id").eq("user_id", this.userId).eq("id", input.leadId).maybeSingle(); if (error || !data) throw new Error("Lead not found"); } const { data, error } = await this.db.from("tasks").insert({ user_id: this.userId, title: input.title, description: input.description ?? null, lead_id: input.leadId ?? null, priority: input.priority ?? "medium", due_at: input.dueAt ?? null }).select().single(); return mapTask(assertResult(data, error, "tasks.create")); }
  async complete(id: string) { const { data, error } = await this.db.from("tasks").update({ status: "completed" }).eq("user_id", this.userId).eq("id", id).select().single(); return mapTask(assertResult(data, error, "tasks.complete")); }
}
