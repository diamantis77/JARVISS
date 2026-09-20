import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "./rate-limit";

export async function checkSharedRateLimit(mode: "demo" | "live", key: string, limit = 12, windowSeconds = 60) { if (mode === "demo") return checkRateLimit(key, limit, windowSeconds * 1000); const { data, error } = await createAdminClient().rpc("consume_rate_limit", { p_bucket_key: key, p_limit: limit, p_window_seconds: windowSeconds }); if (error) return { allowed: false, retryAfter: 30 }; const row = Array.isArray(data) ? data[0] : data; return { allowed: Boolean(row?.allowed), retryAfter: Number(row?.retry_after ?? 0) }; }
