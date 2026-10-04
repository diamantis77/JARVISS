import { z } from "zod";
import type { Lead, Interaction } from "@/types";

export const manualEmailSchema = z.object({
  subject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n]/.test(value), "Invalid subject"),
  body: z.string().trim().min(1).max(5000),
});

export function manualEmailRecipient(lead: Lead): string | null {
  const email = lead.email?.trim() ?? "";
  return z.string().email().safeParse(email).success ? email : null;
}

export function draftMatchesCurrentLead(draft: Interaction, lead: Lead): boolean {
  const recipient = manualEmailRecipient(lead);
  return Boolean(recipient && draft.leadId === lead.id && draft.direction === "outbound" && draft.channel === "email" && draft.recipientEmail === recipient);
}

export function gmailSendConfigured(): boolean {
  return process.env.GOOGLE_GMAIL_ENABLED === "true" &&
    ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_TOKEN_ENCRYPTION_KEY"]
      .every((name) => Boolean(process.env[name]?.trim()));
}

export function manualOutreachBlockReason(interactions: Interaction[], now = new Date()): string | null {
  const emails = interactions.filter((item) => item.channel === "email");
  if (emails.some((item) => item.direction === "inbound" && item.status === "received")) return "Υπάρχει ήδη εισερχόμενη συνομιλία. Χρησιμοποίησε τη ροή απάντησης, όχι νέο cold email.";
  const sent = emails.filter((item) => item.direction === "outbound" && item.status === "sent").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sent.length >= 3) return "Έχουν ήδη σταλεί τρία email χωρίς καταγεγραμμένη απάντηση. Δεν δημιουργείται άλλο follow-up.";
  if (sent[0] && now.getTime() - new Date(sent[0].createdAt).getTime() < 14 * 24 * 60 * 60 * 1000) return "Δεν έχουν περάσει 14 ημέρες από το προηγούμενο email.";
  return null;
}
