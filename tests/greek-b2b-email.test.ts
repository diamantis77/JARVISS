import { describe, expect, it } from "vitest";
import { basicGreekOutreachQuality, GREEK_B2B_EMAIL_POLICY } from "../lib/email/greek-b2b-policy";
import { draftMatchesCurrentLead, manualEmailRecipient, manualOutreachBlockReason } from "../lib/email/manual-outreach";
import { createDemoRepositories } from "../lib/repositories/demo";
import { JARVIS_INSTRUCTIONS_V2 } from "../lib/ai/instructions/v2";
import { executeTool } from "../lib/tools/execute";

describe("Greek B2B outreach policy", () => {
  it("is part of the shared JARVIS instructions and retains exact approval", () => {
    expect(JARVIS_INSTRUCTIONS_V2).toContain(GREEK_B2B_EMAIL_POLICY);
    expect(GREEK_B2B_EMAIL_POLICY).toContain("exact-payload approval");
    expect(GREEK_B2B_EMAIL_POLICY).toContain("Δεν έχετε ιστοσελίδα");
  });

  it("rejects obvious pressure, unsupported no-website claims and non-Greek drafts", () => {
    expect(basicGreekOutreachQuality("SPECIAL OFFER!!!", "Buy now, amazing results!", false)).toContain("greek_missing");
    expect(basicGreekOutreachQuality("Μια ιδέα", "Δεν έχετε ιστοσελίδα. Εγγυημένοι πελάτες!", false)).toContain("unsupported_or_pressuring_claim");
  });

  it("locks a stored draft to the current CRM lead recipient", async () => {
    const repositories = createDemoRepositories();
    const lead = (await repositories.leads.list()).find((item) => manualEmailRecipient(item));
    expect(lead).toBeTruthy();
    const draft = await repositories.interactions.create({ leadId: lead!.id, direction: "outbound", channel: "email", subject: "Μια ιδέα", content: "Κείμενο", status: "draft", recipientEmail: lead!.email });
    expect(draftMatchesCurrentLead(draft, lead!)).toBe(true);
    expect(draftMatchesCurrentLead(draft, { ...lead!, email: "changed@example.com" })).toBe(false);
  });

  it("blocks rapid repeat outreach and inbound threads", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    const recent = { id: "i1", leadId: "l1", direction: "outbound" as const, channel: "email" as const, subject: "Θέμα", content: "Κείμενο", status: "sent", createdAt: "2026-09-24T12:00:00Z" };
    expect(manualOutreachBlockReason([recent], now)).toContain("14 ημέρες");
    expect(manualOutreachBlockReason([{ ...recent, direction: "inbound", status: "received" }], now)).toContain("εισερχόμενη");
    expect(manualOutreachBlockReason([])).toBeNull();
  });

  it("does not persist an AI sales draft without cited stored evidence", async () => {
    const repositories = createDemoRepositories();
    const lead = (await repositories.leads.list()).find((item) => item.email)!;
    const result = await executeTool("draft_outreach", {
      leadId: lead.id, subject: "Μια ιδέα για εσάς", body: "Καλησπέρα σας, θα ήθελα να συζητήσουμε για την επιχείρησή σας.",
      whyThisAngle: "Relevant business research", confidence: "HIGH", sourceEvidence: ["invented-evidence"],
    }, { context: { repositories, mode: "demo" } });
    expect(result.ok).toBe(false);
    expect(await repositories.interactions.listForLead(lead.id)).toHaveLength(0);
  });
});
