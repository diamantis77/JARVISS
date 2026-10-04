import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { generateGreekOutreach, type GreekOutreachSuggestion } from "../lib/email/generate-greek-outreach";
import { basicGreekOutreachQuality } from "../lib/email/greek-b2b-policy";

config({ path: ".env.local", quiet: true });

const leadId = "7354ce3b-5277-4f62-8da3-b4d7ad898c98";
const marker = "greek-b2b-live-smoke-2026-09-29";
const mode = process.argv[2];
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function loadContext() {
  const { data: lead, error: leadError } = await db.from("leads")
    .select("id,user_id,business_name,category,city,email,status")
    .eq("id", leadId).single();
  if (leadError || !lead) throw new Error(`Lead read failed: ${leadError?.message ?? "missing"}`);
  if (lead.status === "lost") throw new Error("Lead is not eligible for outreach");
  if (!lead.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) throw new Error("No valid public contact email");

  const { data: interactions, error: interactionsError } = await db.from("interactions")
    .select("id,direction,channel,status,subject,created_at,metadata_json")
    .eq("lead_id", leadId);
  if (interactionsError) throw new Error(`Interaction read failed: ${interactionsError.message}`);
  if ((interactions ?? []).some((row) => row.metadata_json?.smokeTestMarker === marker)) {
    throw new Error("Smoke test already saved; refusing duplicate draft");
  }
  if ((interactions ?? []).some((row) => row.channel === "email" && row.status === "sent")) {
    throw new Error("Previous sent email exists; not a cold-email test");
  }
  if ((interactions ?? []).some((row) => row.channel === "email" && row.direction === "inbound")) {
    throw new Error("Inbound conversation exists; not a cold-email test");
  }

  const { data: suppression, error: suppressionError } = await db.from("contact_suppressions")
    .select("id").eq("user_id", lead.user_id)
    .eq("normalized_email", lead.email.trim().toLowerCase()).maybeSingle();
  if (suppressionError) throw new Error(`Suppression read failed: ${suppressionError.message}`);
  if (suppression) throw new Error("Recipient is on the do-not-contact list");

  const { data: rows, error: evidenceError } = await db.from("lead_evidence")
    .select("id,field_name,value_text,confidence,evidence_summary,source_id")
    .eq("lead_id", leadId)
    .in("field_name", ["business_identity", "website_status", "website", "online_booking"]);
  if (evidenceError) throw new Error(`Evidence read failed: ${evidenceError.message}`);
  const evidence = (rows ?? []).filter((row) => ["verified", "high"].includes(row.confidence));
  if (!evidence.some((row) => row.field_name === "online_booking") ||
      !evidence.some((row) => row.field_name === "website_status")) {
    throw new Error("Required website evidence is missing");
  }
  return { lead, evidence, interactions: interactions ?? [] };
}

function validateDraft(draft: GreekOutreachSuggestion, evidence: Awaited<ReturnType<typeof loadContext>>["evidence"]) {
  const issues = basicGreekOutreachQuality(draft.subject, draft.email, false);
  const words = draft.email.trim().split(/\s+/).length;
  if (words < 80 || words > 160) issues.push("smoke_length_80_160");
  const ids = new Set(evidence.map((row) => row.id));
  if (draft.sourceEvidence.some((id) => !ids.has(id))) issues.push("unknown_evidence_id");
  if (/δεν έχετε|χωρίς ιστοσελίδα|δεν διαθέτετε|δεν υπάρχει.*(κράτη|ραντεβού)/iu.test(draft.email)) {
    issues.push("overstated_website_or_booking_claim");
  }
  if (/demo|ντέμο|ετοίμασα.*(παρουσίαση|ιστοσελίδα)/iu.test(draft.email)) issues.push("unverified_demo_claim");
  if (issues.length) throw new Error(`Draft quality failed: ${issues.join(",")}`);
  return words;
}

async function main() {
  if (mode !== "generate" && mode !== "save") throw new Error("Use generate or save mode");
  const { lead, evidence } = await loadContext();
  if (mode === "generate") {
    const draft = await generateGreekOutreach({
      businessName: lead.business_name,
      category: lead.category ?? "",
      city: lead.city ?? "",
      country: "Greece",
      evidence: evidence.map((row) => ({
        id: row.id,
        fact: `${row.field_name}: ${row.value_text}; ${row.evidence_summary}`,
        confidence: row.confidence as "verified" | "high",
      })),
      previousContact: [],
      offeredServices: ["βελτίωση υπάρχουσας ιστοσελίδας", "απλούστερη ψηφιακή διαδικασία αιτήματος ραντεβού"],
      senderName: "Διαμαντής",
      followUp: false,
    });
    const wordCount = validateDraft(draft, evidence);
    console.log(JSON.stringify({ leadId, draft, wordCount, model: process.env.OPENAI_MODEL ?? "gpt-5" }));
    return;
  }

  const encoded = process.argv[3];
  if (!encoded) throw new Error("Missing generated draft");
  const draft = JSON.parse(Buffer.from(encoded, "hex").toString("utf8")) as GreekOutreachSuggestion;
  const wordCount = validateDraft(draft, evidence);
  const { data: saved, error: saveError } = await db.from("interactions").insert({
    lead_id: leadId,
    direction: "outbound",
    channel: "email",
    subject: draft.subject,
    content: draft.email,
    status: "draft",
    provider: "google",
    provider_thread_id: null,
    provider_message_id: null,
    recipient_email: lead.email,
    metadata_json: {
      whyThisAngle: draft.whyThisAngle,
      confidence: draft.confidence,
      sourceEvidence: draft.sourceEvidence,
      language: "el-GR",
      smokeTestMarker: marker,
      model: process.env.OPENAI_MODEL ?? "gpt-5",
    },
  }).select("id,lead_id,status,provider_message_id,created_at").single();
  if (saveError || !saved) throw new Error(`Draft save failed: ${saveError?.message ?? "missing"}`);
  const { data: verified, error: verifyError } = await db.from("interactions")
    .select("id,lead_id,status,provider_message_id,created_at")
    .eq("id", saved.id).single();
  if (verifyError || !verified) throw new Error(`Draft read-back failed: ${verifyError?.message ?? "missing"}`);
  if (verified.status !== "draft" || verified.provider_message_id !== null || verified.lead_id !== leadId) {
    throw new Error("Saved interaction is not an unsent lead draft");
  }
  console.log(JSON.stringify({ id: verified.id, status: verified.status, providerMessageId: verified.provider_message_id,
    wordCount, createdAt: verified.created_at, gmailActionInvoked: false, phoneActionInvoked: false }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : "Unknown smoke-test error");
  process.exitCode = 1;
});
