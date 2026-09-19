import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repositories } from "@/lib/repositories/contracts";
import { SupabaseLeadRepository } from "./lead-repository";
import { SupabaseTaskRepository } from "./task-repository";
import { SupabaseActivityRepository } from "./activity-repository";
import { SupabaseInteractionRepository } from "./interaction-repository";
import { SupabaseJarvisRunRepository } from "./run-repository";
import { SupabaseApprovalRepository } from "./approval-repository";
import { SupabaseSettingsRepository } from "./settings-repository";

export function createSupabaseRepositories(db: SupabaseClient, userId: string): Repositories {
  return { leads: new SupabaseLeadRepository(db, userId), tasks: new SupabaseTaskRepository(db, userId), activity: new SupabaseActivityRepository(db, userId), interactions: new SupabaseInteractionRepository(db, userId), runs: new SupabaseJarvisRunRepository(db, userId), approvals: new SupabaseApprovalRepository(db, userId), settings: new SupabaseSettingsRepository(db, userId) };
}
