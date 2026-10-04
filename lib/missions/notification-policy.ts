export type MissionPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export function missionPhonePolicy(priority: MissionPriority, phoneEnabled: boolean, globallyEnabled: boolean, lastQueuedAt: string | null, cooldownMinutes: number, now = new Date()) {
  if (!globallyEnabled) return { allowed: false, reason: "feature_disabled" } as const;
  if (!phoneEnabled || (priority !== "HIGH" && priority !== "URGENT")) return { allowed: false, reason: "rule_disabled" } as const;
  if (lastQueuedAt && now.getTime() - new Date(lastQueuedAt).getTime() < cooldownMinutes * 60_000) return { allowed: false, reason: "cooldown" } as const;
  return { allowed: true, reason: null } as const;
}
