type Header = { name?: string | null; value?: string | null };

function value(headers: Header[] | undefined, name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name)?.value?.trim().toLowerCase() ?? "";
}

// A call requires a matching sent thread and a human sender. Subject/snippet
// text is untrusted and must never be sufficient to authorize a phone job.
export function isHumanCustomerReply(headers: Header[] | undefined, sender: string, ownerEmail: string | null | undefined) {
  if (!sender || !ownerEmail || sender === ownerEmail.trim().toLowerCase()) return false;
  if (/^(no-?reply|mailer-daemon|postmaster)@/i.test(sender)) return false;
  const autoSubmitted = value(headers, "auto-submitted");
  if (autoSubmitted && autoSubmitted !== "no") return false;
  if (/^(bulk|list|junk)$/i.test(value(headers, "precedence"))) return false;
  if (value(headers, "list-id")) return false;
  return true;
}

export function isVerifiedCustomerReply(input: { humanSender: boolean; duplicateInteraction: boolean; sentThreadMatched: boolean; missionThreadMatched: boolean; duplicateMissionReply: boolean; receivedAt: string; now?: number }) {
  const ageMs = (input.now ?? Date.now()) - new Date(input.receivedAt).getTime();
  // Never turn an old Gmail reconciliation/backfill into an unexpected call.
  const fresh = Number.isFinite(ageMs) && ageMs >= -60_000 && ageMs <= 30 * 60_000;
  return fresh && input.humanSender && !input.duplicateInteraction && (input.sentThreadMatched || (input.missionThreadMatched && !input.duplicateMissionReply));
}
