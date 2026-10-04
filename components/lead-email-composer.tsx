"use client";

import { useState } from "react";
import Link from "next/link";

type Suggestion = { subject: string; email: string; whyThisAngle: string; confidence: "HIGH" | "MEDIUM" | "LOW"; sourceEvidence: string[] };

export function LeadEmailComposer({ leadId, recipient, live, gmailReady }: { leadId: string; recipient: string | null; live: boolean; gmailReady: boolean }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [evidence, setEvidence] = useState<Array<{ id: string; fact: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [approvalId, setApprovalId] = useState<string | null>(null);

  async function generate() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/leads/${leadId}/email-suggestion`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Δεν ήταν δυνατή η δημιουργία πρότασης.");
      setSuggestion(result.suggestion); setEvidence(result.evidence);
      setSubject(result.suggestion.subject); setBody(result.suggestion.email);
      setMessage("Πρόταση από αποθηκευμένα στοιχεία. Έλεγξε κάθε ισχυρισμό πριν ζητήσεις έγκριση.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Δεν ήταν δυνατή η δημιουργία πρότασης."); }
    finally { setBusy(false); }
  }

  async function requestApproval() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/leads/${leadId}/email-approval`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Δεν ήταν δυνατή η αίτηση έγκρισης.");
      setApprovalId(result.approvalId); setMessage(result.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Δεν ήταν δυνατή η αίτηση έγκρισης."); }
    finally { setBusy(false); }
  }

  return <section className="panel detail-block lead-email-composer" id="email">
    <p className="panel-title">OUTREACH · ΑΠΑΙΤΕΙ ΕΓΚΡΙΣΗ</p>
    <h2>Προσωπικό email για αυτό το lead</h2>
    <p className="subtitle">Ο JARVIS προτείνει ελληνικό email από τα αποθηκευμένα στοιχεία. Μπορείς να το αλλάξεις πριν κλειδώσει για έγκριση. Καμία αποστολή δεν γίνεται αυτόματα.</p>
    <label>Παραλήπτης<input value={recipient ?? "Δεν υπάρχει email στο CRM"} readOnly /></label>
    <div className="response-actions"><button className="secondary" disabled={!live || !recipient || busy || Boolean(approvalId)} onClick={() => void generate()}>Δημιουργία τεκμηριωμένης πρότασης</button></div>
    {suggestion && <div className="lead-email-rationale"><b>Γιατί αυτή η προσέγγιση</b><p>{suggestion.whyThisAngle}</p><small>Βεβαιότητα: {suggestion.confidence}</small><details><summary>Στοιχεία που χρησιμοποιήθηκαν</summary>{evidence.map((item) => <p key={item.id}>{item.fact}</p>)}</details></div>}
    <label>Θέμα<input maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} disabled={Boolean(approvalId)} placeholder="Σύντομο, συγκεκριμένο θέμα" /></label>
    <label>Κείμενο<textarea maxLength={5000} rows={10} value={body} onChange={(event) => setBody(event.target.value)} disabled={Boolean(approvalId)} placeholder="Γράψε ή επεξεργάσου το προσωπικό email…" /></label>
    {!gmailReady && live && <p className="subtitle">Για να ζητήσεις έγκριση αποστολής, ρύθμισε πρώτα το Google OAuth και σύνδεσε Gmail με δικαίωμα αποστολής στις <Link href="/settings">Ρυθμίσεις</Link>.</p>}
    {!recipient && <p className="subtitle">Χρειάζεται καταχωρισμένο, έγκυρο email στο CRM.</p>}
    <div className="response-actions"><button className="primary" disabled={!gmailReady || !recipient || !subject.trim() || !body.trim() || busy || Boolean(approvalId)} onClick={() => void requestApproval()}>Ζήτηση έγκρισης — όχι αποστολή</button></div>
    {message && <div className="auth-message" role="status">{message}</div>}
    {approvalId && <p><Link className="secondary" href="/#approvals">Άνοιγμα ακριβούς έγκρισης →</Link></p>}
  </section>;
}
