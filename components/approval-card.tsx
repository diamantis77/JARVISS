"use client";
import { useState } from "react";
import type { Approval } from "@/types";

export function ApprovalCard({ approval, onDecision, onEdit }: { approval: Approval; onDecision: (decision: "approved" | "rejected") => void | Promise<void>; onEdit?: (patch: { subject: string; preview: string }) => Promise<void> }) {
  const [editing, setEditing] = useState(false); const [subject, setSubject] = useState(approval.subject); const [preview, setPreview] = useState(approval.preview); const [busy, setBusy] = useState(false);
  if (approval.status !== "pending") return null;
  async function save() { if (!onEdit) return; setBusy(true); try { await onEdit({ subject, preview }); setEditing(false); } finally { setBusy(false); } }
  return <section className="approval panel"><p className="panel-title">Action requires approval</p><strong>{approval.actionType.replaceAll("_", " ")}</strong><p><b>Recipient:</b> {approval.recipient}</p>{editing ? <div className="approval-edit"><label>Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label><label>Preview<textarea rows={6} value={preview} onChange={(event) => setPreview(event.target.value)} /></label></div> : <><p><b>Subject:</b> {approval.subject}</p><p>{approval.preview}</p></>}<div className="approval-actions">{editing ? <><button className="primary" disabled={busy} onClick={() => void save()}>Save draft</button><button className="secondary" onClick={() => setEditing(false)}>Cancel</button></> : <><button className="primary" onClick={() => void onDecision("approved")}>Approve</button>{onEdit && <button className="secondary" onClick={() => setEditing(true)}>Edit</button>}<button className="secondary" onClick={() => void onDecision("rejected")}>Reject</button></>}</div></section>;
}
