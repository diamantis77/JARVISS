import type { PhoneCallStatus } from "@/types";

export const TERMINAL_PHONE_STATUSES = new Set<PhoneCallStatus>(["completed", "failed", "busy", "no_answer", "cancelled"]);

export function normalizeTwilioCallStatus(value: string): PhoneCallStatus {
  if (value === "ringing") return "ringing";
  if (value === "in-progress") return "in_progress";
  if (value === "completed") return "completed";
  if (value === "busy") return "busy";
  if (value === "no-answer") return "no_answer";
  if (value === "canceled") return "cancelled";
  if (value === "failed") return "failed";
  return "dialing";
}

export function normalizeVonageCallStatus(value: string): PhoneCallStatus {
  if (value === "ringing") return "ringing";
  if (value === "answered") return "in_progress";
  if (value === "completed") return "completed";
  if (value === "busy") return "busy";
  if (value === "unanswered" || value === "timeout") return "no_answer";
  if (value === "cancelled" || value === "rejected") return "cancelled";
  if (value === "failed") return "failed";
  return "dialing";
}

export function mayApplyPhoneStatus(current: PhoneCallStatus, incoming: PhoneCallStatus) {
  if (TERMINAL_PHONE_STATUSES.has(current)) return current === incoming;
  if (TERMINAL_PHONE_STATUSES.has(incoming)) return true;
  const progress: Partial<Record<PhoneCallStatus, number>> = { queued: 0, dialing: 1, ringing: 2, in_progress: 3 };
  return (progress[incoming] ?? 0) >= (progress[current] ?? 0);
}
