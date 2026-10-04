import type { SupabaseClient } from "@supabase/supabase-js";

type Arm = {
  id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};

export function isEligibleOwnerSelfTestReply(input: {
  sender: string;
  connectedAddress: string;
  messageId: string;
  threadId: string;
  receivedAt: string;
  arm: Arm;
  now?: number;
}) {
  const { arm } = input;
  const sentMessageId = arm.payload.providerMessageId;
  const sentThreadId = arm.payload.providerThreadId;
  const sentAt = Date.parse(String(arm.payload.sentAt ?? ""));
  const armedAt = Date.parse(arm.occurred_at);
  const expiresAt = Date.parse(String(arm.payload.expiresAt ?? ""));
  const receivedAt = Date.parse(input.receivedAt);
  const now = input.now ?? Date.now();
  return input.sender.trim().toLowerCase() === input.connectedAddress.trim().toLowerCase()
    && typeof sentMessageId === "string" && sentMessageId.length > 0
    && input.messageId !== sentMessageId
    && typeof sentThreadId === "string" && input.threadId === sentThreadId
    && Number.isFinite(sentAt) && Number.isFinite(armedAt) && Number.isFinite(expiresAt) && Number.isFinite(receivedAt)
    && receivedAt > sentAt && receivedAt >= armedAt
    && receivedAt <= now + 60_000 && now - receivedAt <= 30 * 60_000
    && now < expiresAt;
}

/** Atomically consume one owner-authorized, exact-thread self-test before a call can be queued. */
export async function claimOwnerSelfTestReplyCall(db: SupabaseClient, input: {
  userId: string;
  sender: string;
  connectedAddress: string;
  messageId: string;
  threadId: string;
  receivedAt: string;
}) {
  const lookup = await db.from("internal_events")
    .select("id,occurred_at,payload")
    .eq("user_id", input.userId)
    .eq("event_type", "OWNER_SELF_TEST_REPLY_ARMED")
    .contains("payload", { providerThreadId: input.threadId })
    .is("processed_at", null)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lookup.error) throw new Error("Unable to inspect owner self-test authorization");
  const arm = lookup.data as Arm | null;
  if (!arm || !isEligibleOwnerSelfTestReply({ ...input, arm })) return null;
  const claim = await db.from("internal_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", arm.id)
    .eq("user_id", input.userId)
    .is("processed_at", null)
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error("Unable to consume owner self-test authorization");
  return claim.data ? arm.id : null;
}
