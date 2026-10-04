import type { SupabaseClient } from "@supabase/supabase-js";
import type { MissionRepository, MissionToday } from "../contracts";
import { MissionService } from "../../missions/service";

export class SupabaseMissionRepository implements MissionRepository {
  constructor(private readonly db: SupabaseClient, private readonly userId: string) {}

  async today(): Promise<{ available: boolean; missions: MissionToday[] }> {
    const service = new MissionService(this.db, this.userId);
    if (!await service.schemaReady()) return { available: false, missions: [] };
    const missions = await service.list();
    const snapshots = await Promise.all(missions.map((mission) => service.snapshot(mission)));
    return { available: true, missions: snapshots.map((snapshot) => ({
      id: snapshot.mission.id,
      title: snapshot.mission.title,
      status: snapshot.mission.status,
      runStatus: snapshot.run?.status ?? null,
      discovered: snapshot.metrics.discovered,
      qualified: snapshot.metrics.qualified,
      outreachSent: snapshot.metrics.outreachSent,
      replies: snapshot.metrics.replies,
      interested: snapshot.metrics.interested,
      meetings: snapshot.metrics.meetings,
      pendingApprovals: snapshot.metrics.pendingApprovals,
      nextAction: snapshot.nextAction,
      lastActivityAt: snapshot.events[0]?.created_at ?? null,
      briefing: snapshot.briefing?.summary ?? null,
    })) };
  }
}
