import type { ActivityRepository } from "@/lib/repositories/contracts";
import { assertResult, mapActivity, type DbClient } from "./shared";

export class SupabaseActivityRepository implements ActivityRepository {
  constructor(private readonly db: DbClient, private readonly userId: string) {}
  async list(limit = 20) { const { data, error } = await this.db.from("activity_logs").select("*").eq("user_id", this.userId).order("created_at", { ascending: false }).limit(limit); return assertResult(data, error, "activity.list").map(mapActivity); }
  async create(input: Parameters<ActivityRepository["create"]>[0]) { const { data, error } = await this.db.from("activity_logs").insert({ user_id: this.userId, event_type: input.eventType, title: input.title, description: input.description, metadata: input.metadata ?? {} }).select().single(); return mapActivity(assertResult(data, error, "activity.create")); }
}
