"use client";
import { useState } from "react";
import type { Approval } from "@/types";
import { tr } from "@/lib/i18n";

export function ApprovalCard({ approval, onDecision, onEdit }: { approval: Approval; onDecision: (decision: "approved" | "rejected") => void | Promise<void>; onEdit?: (patch: { subject: string; preview: string }) => Promise<void> }) {
  const [editing, setEditing] = useState(false); const [subject, setSubject] = useState(approval.subject); const [preview, setPreview] = useState(approval.preview); const [busy, setBusy] = useState(false);
  if (approval.status !== "pending") return null;
  const email = approval.actionType === "send_email"; const calendar = approval.actionType.includes("calendar"); const approveLabel = email ? tr("Approve & Send") : calendar ? tr("Approve Calendar Action") : tr("Approve");
  async function save() { if (!onEdit || busy) return; setBusy(true); try { await onEdit({ subject, preview }); setEditing(false); } finally { setBusy(false); } }
  async function decide(decision: "approved" | "rejected") { if (busy) return; setBusy(true); try { await onDecision(decision); } finally { setBusy(false); } }
  return <section className="approval panel"><p className="panel-title">{tr(email ? "EMAIL SEND · APPROVAL REQUIRED" : calendar ? "CALENDAR · APPROVAL REQUIRED" : "Action requires approval")}</p><strong>{approval.actionType.replaceAll("_", " ")}</strong><p><b>{tr(calendar ? "Target:" : "Recipient:")}</b> {approval.recipient}</p>{editing ? <div className="approval-edit"><label>{tr("Subject")}<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label><label>{tr(email ? "Message" : "Details")}<textarea rows={6} value={preview} onChange={(event) => setPreview(event.target.value)} /></label></div> : <><p><b>{tr("Subject")}:</b> {approval.subject}</p><p>{approval.preview}</p></>}<div className="approval-actions">{editing ? <><button className="primary" disabled={busy} onClick={() => void save()}>{tr("Save & rebind")}</button><button className="secondary" disabled={busy} onClick={() => setEditing(false)}>{tr("Cancel")}</button></> : <><button className="primary" disabled={busy} onClick={() => void decide("approved")}>{busy ? "Σε εξέλιξη…" : approveLabel}</button>{onEdit && !email && <button className="secondary" disabled={busy} onClick={() => setEditing(true)}>{tr("Edit")}</button>}<button className="secondary" disabled={busy} onClick={() => void decide("rejected")}>{tr("Reject")}</button></>}</div></section>;
}
