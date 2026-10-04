import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTelephonyStatus } from "@/lib/telephony/config";
import { queueOwnerCall } from "@/lib/telephony/call-owner";

const requestSchema = z.object({ reason: z.string().trim().min(2).max(500), urgent: z.boolean().default(false), context: z.record(z.unknown()).default({}) });

export async function POST(request: Request) {
  const { user } = await getAuthenticatedUser();
  if (!user) return Response.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "A short call reason is required." }, { status: 400 });
  const readiness = getTelephonyStatus();
  if (readiness.readiness !== "ready") return Response.json({ error: "Telephony is not ready. Check the provider status in Settings." }, { status: 503 });
  const db = createAdminClient();
  try {
    const minute = new Date().toISOString().slice(0, 16);
    const deduplicationKey = `owner-call:${user.id}:${minute}`;
    const result = await queueOwnerCall(db, { userId: user.id, reason: parsed.data.reason, context: { ...parsed.data.context, urgent: parsed.data.urgent }, urgent: parsed.data.urgent, deduplicationKey });
    if (!result.queued) return Response.json({ error: result.reason }, { status: 409 });
    return Response.json({ call: result.call, jobId: result.job.id }, { status: 202 });
  } catch {
    return Response.json({ error: "The phone call could not be queued safely." }, { status: 503 });
  }
}
