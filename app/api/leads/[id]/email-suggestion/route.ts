import { createRequestRepositories } from "@/lib/repositories/factory";
import { generateGreekOutreach } from "@/lib/email/generate-greek-outreach";
import { manualEmailRecipient, manualOutreachBlockReason } from "@/lib/email/manual-outreach";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories();
  if (!context || context.mode !== "live") return Response.json({ error: "Απαιτείται σύνδεση σε Live Mode." }, { status: 401 });
  const leadId = (await params).id;
  const lead = await context.repositories.leads.getById(leadId);
  if (!lead) return Response.json({ error: "Το lead δεν βρέθηκε." }, { status: 404 });
  const recipient = manualEmailRecipient(lead);
  if (!recipient) return Response.json({ error: "Δεν υπάρχει έγκυρο email για αυτό το lead." }, { status: 409 });
  if (await context.repositories.interactions.isMissionContactSuppressed(recipient)) return Response.json({ error: "Ο παραλήπτης έχει εξαιρεθεί από επικοινωνία." }, { status: 409 });
  const [evidence, analyses, interactions, settings] = await Promise.all([
    context.repositories.evidence.listEvidenceForLead(leadId),
    context.repositories.evidence.listWebsiteAnalysesForLead(leadId),
    context.repositories.interactions.listForLead(leadId),
    context.repositories.settings.get(),
  ]);
  const contactBlock = manualOutreachBlockReason(interactions);
  if (contactBlock) return Response.json({ error: contactBlock }, { status: 409 });
  const verified = evidence.filter((item) => item.confidence === "verified" || item.confidence === "high" || item.confidence === "medium").slice(0, 12)
    .map((item) => ({ id: item.id, confidence: item.confidence as "verified" | "high" | "medium", fact: `${item.fieldName}: ${item.valueText}; ${item.evidenceSummary}`.slice(0, 450) }));
  const latest = analyses[0];
  if (latest && latest.status === "completed") {
    verified.push({ id: `analysis:${latest.id}`, confidence: "high", fact: `Official website analysis of ${latest.websiteUrl}: booking ${latest.hasBooking === null ? "unknown" : latest.hasBooking ? "detected" : "not detected on analyzed pages"}; contact form ${latest.hasContactForm === null ? "unknown" : latest.hasContactForm ? "detected" : "not detected on analyzed pages"}; clear CTA ${latest.hasClearCta === null ? "unknown" : latest.hasClearCta ? "detected" : "not detected on analyzed pages"}.` });
  }
  if (!verified.length) return Response.json({ error: "Δεν υπάρχουν αρκετά τεκμηριωμένα στοιχεία. Κάνε πρώτα έρευνα για το lead." }, { status: 409 });
  const priorSent = interactions.filter((item) => item.channel === "email" && item.direction === "outbound" && item.status === "sent");
  try {
    const suggestion = await generateGreekOutreach({
      businessName: lead.businessName, category: lead.category, city: lead.city, country: lead.country,
      evidence: verified, previousContact: interactions.slice(0, 6).map((item) => ({ direction: item.direction, status: item.status, subject: item.subject, createdAt: item.createdAt })),
      offeredServices: settings.companyServices, senderName: settings.fullName, followUp: priorSent.length > 0,
    });
    return Response.json({ suggestion, evidence: verified.filter((item) => suggestion.sourceEvidence.includes(item.id)), message: "Πρόταση μόνο. Ελέγξτε κάθε ισχυρισμό πριν ζητήσετε έγκριση." });
  } catch {
    return Response.json({ error: "Δεν προέκυψε ασφαλές, τεκμηριωμένο προσχέδιο. Δεν αποθηκεύτηκε ή στάλθηκε email." }, { status: 503 });
  }
}
