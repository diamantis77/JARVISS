import type { SupabaseClient } from "@supabase/supabase-js";
import { MissionService } from "./service";

export type MissionSnapshot = Awaited<ReturnType<MissionService["snapshot"]>>;

export type MissionDashboardData = {
  available: boolean;
  reason?: string;
  missions: MissionSnapshot[];
  phoneNotificationsEnabled: boolean;
};

export async function readMissionDashboard(db: SupabaseClient, userId: string): Promise<MissionDashboardData> {
  const service = new MissionService(db, userId);
  if (!await service.schemaReady()) {
    return { available: false, reason: "Migration 0013 is not applied", missions: [], phoneNotificationsEnabled: false };
  }
  const missions = await Promise.all((await service.list()).map((mission) => service.snapshot(mission)));
  return { available: true, missions, phoneNotificationsEnabled: process.env.MISSION_PHONE_NOTIFICATIONS_ENABLED === "true" };
}
