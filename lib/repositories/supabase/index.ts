import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repositories } from "@/lib/repositories/contracts";
import { SupabaseLeadRepository } from "./lead-repository";
import { SupabaseTaskRepository } from "./task-repository";
import { SupabaseActivityRepository } from "./activity-repository";
import { SupabaseInteractionRepository } from "./interaction-repository";
import { SupabaseJarvisRunRepository } from "./run-repository";
import { SupabaseApprovalRepository } from "./approval-repository";
import { SupabaseSettingsRepository } from "./settings-repository";
import { SupabaseResearchRepository } from "./research-repository";
import { SupabaseVoiceRepository } from "./voice-repository";
import { SupabaseEvidenceRepository } from "./evidence-repository";
import { SupabaseConnectionRepository } from "./connection-repository";
import { SupabaseNotificationRepository } from "./notification-repository";
import { SupabaseOperationsRepository } from "./operations-repository";
import { SupabaseMissionRepository } from "./mission-repository";

export function createSupabaseRepositories(db: SupabaseClient, userId: string): Repositories {
  return { leads: new SupabaseLeadRepository(db, userId), tasks: new SupabaseTaskRepository(db, userId), activity: new SupabaseActivityRepository(db, userId), interactions: new SupabaseInteractionRepository(db, userId), runs: new SupabaseJarvisRunRepository(db, userId), approvals: new SupabaseApprovalRepository(db, userId), settings: new SupabaseSettingsRepository(db, userId), research: new SupabaseResearchRepository(db, userId), evidence: new SupabaseEvidenceRepository(db, userId), voice: new SupabaseVoiceRepository(db, userId), connections: new SupabaseConnectionRepository(db, userId), notifications: new SupabaseNotificationRepository(db, userId), operations: new SupabaseOperationsRepository(db, userId), missions: new SupabaseMissionRepository(db, userId) };
}
