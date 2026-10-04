import { createRequestRepositories } from "@/lib/repositories/factory";
import { manualEmailRecipient, manualEmailSchema, gmailSendConfigured, manualOutreachBlockReason } from "@/lib/email/manual-outreach";
import { hasCapability } from "@/lib/google/scopes";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories();
  if (!context || context.mode !== "live") return Response.json({ error: "Απαιτείται σύνδεση σε Live Mode." }, { status: 401 });
  const parsed = manualEmailSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Συμπλήρωσε έγκυρο θέμα και κείμενο." }, { status: 400 });
  const lead = await context.repositories.leads.getById((await params).id);
  if (!lead) return Response.json({ error: "Το lead δεν βρέθηκε." }, { status: 404 });
  const recipient = manualEmailRecipient(lead);
  if (!recipient) return Response.json({ error: "Το lead δεν έχει έγκυρο email στο CRM." }, { status: 409 });
  if (await context.repositories.interactions.isMissionContactSuppressed(recipient)) {
    return Response.json({ error: "Ο παραλήπτης βρίσκεται στη λίστα μη επικοινωνίας." }, { status: 409 });
  }
  const contactBlock = manualOutreachBlockReason(await context.repositories.interactions.listForLead(lead.id));
  if (contactBlock) return Response.json({ error: contactBlock }, { status: 409 });
  if (!gmailSendConfigured()) return Response.json({ error: "Το Gmail OAuth δεν έχει ρυθμιστεί. Το email δεν στάλθηκε ούτε ζητήθηκε έγκριση." }, { status: 409 });
  const connection = await context.repositories.connections.getGoogle();
  if (!connection || connection.status !== "connected" || !hasCapability(connection.scopes, "gmail") || !connection.refreshTokenEncrypted) {
    return Response.json({ error: "Σύνδεσε το Gmail με δικαίωμα αποστολής στις Ρυθμίσεις. Δεν στάλθηκε email." }, { status: 409 });
  }

  try {
    const draft = await context.repositories.interactions.create({
      leadId: lead.id, direction: "outbound", channel: "email", subject: parsed.data.subject,
      content: parsed.data.body, status: "draft", provider: "google", providerThreadId: null,
      providerMessageId: null, recipientEmail: recipient, metadata: { source: "manual_lead_selection", sendingAccount: connection.providerEmail },
    });
    const run = await context.repositories.runs.createRun(`Manual email approval for lead ${lead.id}`);
    const approval = await context.repositories.approvals.create({
      runId: run.id, actionType: "send_email", recipient, subject: parsed.data.subject, preview: parsed.data.body,
      payload: { toolName: "send_email", manualLeadId: lead.id, input: {
        draftId: draft.id, recipient, subject: parsed.data.subject, body: parsed.data.body, accountEmail: connection.providerEmail, threadId: null, inReplyTo: null,
      } },
    });
    await context.repositories.runs.updateRun(run.id, { status: "waiting_for_approval", summary: "Email draft awaits exact-payload owner approval. Nothing has been sent." });
    await context.repositories.activity.create({ eventType: "outreach", title: "Email draft awaiting approval", description: lead.businessName, metadata: { leadId: lead.id, draftId: draft.id, approvalId: approval.id } });
    return Response.json({ approvalId: approval.id, message: "Το email ετοιμάστηκε για έγκριση. Δεν στάλθηκε." });
  } catch {
    return Response.json({ error: "Δεν ολοκληρώθηκε η προετοιμασία της έγκρισης. Κανένα email δεν στάλθηκε." }, { status: 503 });
  }
}
