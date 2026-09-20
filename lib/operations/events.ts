import type { SupabaseClient } from "@supabase/supabase-js";
import type { InternalEventType } from "@/types";

export async function emitInternalEvent(db: SupabaseClient, input: { userId: string; eventType: InternalEventType; payload?: Record<string, unknown>; correlationId: string; deduplicationKey?: string | null }) { const { data, error } = await db.from("internal_events").insert({ user_id: input.userId, event_type: input.eventType, payload: input.payload ?? {}, correlation_id: input.correlationId, deduplication_key: input.deduplicationKey ?? null }).select().single(); if (!error && data) return data; if (input.deduplicationKey) { const existing = await db.from("internal_events").select("*").eq("deduplication_key", input.deduplicationKey).maybeSingle(); if (existing.data) return existing.data; } throw new Error("Unable to persist internal event"); }

export function operationLog(event: string, metadata: Record<string, unknown>) { const safe = Object.fromEntries(Object.entries(metadata).filter(([key]) => !/token|secret|body|content|description/i.test(key))); console.info(JSON.stringify({ event, at: new Date().toISOString(), ...safe })); }
