export type LogEvent = "run_started" | "tool_called" | "tool_completed" | "tool_failed" | "approval_requested" | "approval_approved" | "approval_rejected";

export function log(event: LogEvent, metadata: Record<string, unknown> = {}) {
  // Keep logs structured; callers must never pass credentials or message secrets.
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...metadata }));
}
