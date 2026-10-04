import type { Approval } from "@/types";

/** Keep the visible approval aligned with the latest server snapshot. */
export function selectPendingApproval(current: Approval | null, pending: Approval[]): Approval | null {
  if (current) {
    const refreshed = pending.find((item) => item.id === current.id);
    if (refreshed) return refreshed;
  }
  return pending[0] ?? null;
}
