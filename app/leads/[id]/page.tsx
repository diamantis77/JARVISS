import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { demoAnalyses } from "@/lib/demo-data";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { LeadEmailComposer } from "@/components/lead-email-composer";
import { gmailSendConfigured, manualEmailRecipient } from "@/lib/email/manual-outreach";
import { hasCapability } from "@/lib/google/scopes";

export const dynamic = "force-dynamic";

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}

const known = (value: boolean | null) => value === null ? "Unknown" : value ? "Detected" : "Not detected on analyzed pages";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories(); if (!context) redirect("/auth/sign-in");
  const { id } = await params;
  const [lead, allTasks, interactions, sources, evidence, analyses, googleConnection, pendingApprovals] = await Promise.all([
    context.repositories.leads.getById(id), context.repositories.tasks.list(), context.repositories.interactions.listForLead(id),
    context.repositories.evidence.listSourcesForLead(id), context.repositories.evidence.listEvidenceForLead(id), context.repositories.evidence.listWebsiteAnalysesForLead(id), context.repositories.connections.getGoogle().catch(() => null), context.repositories.approvals.getPending(),
  ]);
  if (!lead) notFound();
  const legacyDemoAnalysis = context.mode === "demo" ? demoAnalyses[id] : undefined;
  const gmailReady = context.mode === "live" && gmailSendConfigured() && googleConnection?.status === "connected" && hasCapability(googleConnection.scopes, "gmail") && Boolean(googleConnection.refreshTokenEncrypted);
  const suppressed = lead.email ? await context.repositories.interactions.isMissionContactSuppressed(lead.email) : false;
  const latestEmail = [...interactions].filter((item) => item.channel === "email" && item.direction === "outbound").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const pendingEmail = latestEmail && pendingApprovals.some((item) => item.actionType === "send_email" && (item.payload?.input as { draftId?: string } | undefined)?.draftId === latestEmail.id);
  const replied = latestEmail?.providerThreadId && interactions.some((item) => item.direction === "inbound" && item.providerThreadId === latestEmail.providerThreadId && item.metadata?.linkedOutreachId === latestEmail.id);
  const emailState = suppressed ? "SUPPRESSED" : replied ? "REPLIED" : pendingEmail ? "PENDING APPROVAL" : latestEmail?.status === "sent" ? "SENT" : latestEmail?.status === "sending" ? "DELIVERY UNKNOWN — CHECK GMAIL" : latestEmail?.status === "failed" ? "FAILED" : latestEmail?.status === "draft" ? "DRAFT" : "NO DRAFT";
  const latest = analyses[0]; const tasks = allTasks.filter((task) => task.leadId === id); const website = safeExternalUrl(lead.website);
  return <main className="page">
    <Link href="/leads" className="subtitle"><ArrowLeft size={13} /> All leads</Link>
    <div className="page-head"><div><p className="panel-title">Lead intelligence · {context.mode} record</p><h1>{lead.businessName}</h1><p className="subtitle">{lead.category} · {lead.city}, {lead.country}</p></div>{website && <a className="secondary" href={website} target="_blank" rel="noopener noreferrer">Website <ExternalLink size={12} /></a>}</div>
    <div className="detail-grid"><div>
      <section className="panel detail-block"><p className="panel-title">Opportunity</p><h2>{lead.opportunitySummary}</h2><p>{lead.scoreReason}</p><div className="response-actions"><Link href="#email" className="primary">Ετοίμασε email</Link><Link href={`/?command=${encodeURIComponent(`Create a task for ${lead.businessName}`)}`} className="secondary">Create task</Link>{website && <Link href={`/?command=${encodeURIComponent(`Research the website of lead ${lead.id} again using ${website}`)}`} className="secondary"><RefreshCw size={12} /> Research again</Link>}</div></section>
      <div style={{ marginTop: 18 }}><p className="status" aria-live="polite">Email: {emailState}</p><LeadEmailComposer leadId={lead.id} recipient={manualEmailRecipient(lead)} live={context.mode === "live"} gmailReady={gmailReady} /></div>
      <section className="panel detail-block" style={{ marginTop: 18 }}><p className="panel-title">Website analysis</p>{latest ? <><div className="evidence-grid"><p><b>Pages</b><br />{latest.pagesAnalyzed.length}</p><p><b>Booking</b><br />{known(latest.hasBooking)}</p><p><b>Clear CTA</b><br />{known(latest.hasClearCta)}</p><p><b>Mobile viewport</b><br />{known(latest.hasViewportMeta)}</p></div><h2>Evidence-backed gaps</h2>{latest.digitalGaps.length ? <ul>{latest.digitalGaps.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No supported gap was detected.</p>}<h2>Opportunities</h2>{latest.opportunities.length ? <ul>{latest.opportunities.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Unknown — no supported recommendation.</p>}<h2>Unknowns</h2>{latest.unknowns.length ? <ul>{latest.unknowns.map((item) => <li key={item}>{item}</li>)}</ul> : <p>None recorded for the analyzed signals.</p>}</> : legacyDemoAnalysis ? <><p className="status">Seeded fictional demo analysis</p><ul>{legacyDemoAnalysis.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul><h2>Recommended opportunities</h2><ul>{legacyDemoAnalysis.opportunities.map((item) => <li key={item}>{item}</li>)}</ul></> : <p>Analysis is Unknown. JARVIS does not infer a negative result from missing evidence.</p>}</section>
      <section className="panel detail-block" style={{ marginTop: 18 }}><p className="panel-title">Evidence</p>{evidence.length ? evidence.map((item) => <div className="evidence-row" key={item.id}><div><b>{item.fieldName.replaceAll("_", " ")}</b><p>{item.valueText}</p><small>{item.evidenceSummary}</small></div><span className="status">{item.confidence}</span></div>) : <p>No research evidence is stored. Values without evidence remain Unknown.</p>}</section>
      <section className="panel detail-block" style={{ marginTop: 18 }}><p className="panel-title">Sources</p>{sources.length ? sources.map((source) => { const url = safeExternalUrl(source.sourceUrl); return <div className="source-row" key={source.id}><div><b>{source.title || "Public source"}</b><p>{source.sourceType.replaceAll("_", " ")} · retrieved {new Date(source.retrievedAt).toLocaleString()}</p></div>{url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open source ${source.title}`}><ExternalLink size={14} /></a>}</div>; }) : <p>No citations are stored for this lead.</p>}</section>
      <section className="panel detail-block" style={{ marginTop: 18 }}><p className="panel-title">Interactions</p>{interactions.length ? interactions.map((item) => <p key={item.id}><b>{item.subject ?? item.channel}</b><br />{item.content}<br /><span className="status">{item.status}</span></p>) : <p>No interactions stored.</p>}</section>
    </div><aside>
      <section className="panel detail-block"><p className="panel-title">Evidence score</p><div className="hero-score">{lead.score}<small style={{ fontSize: 14 }}>/100</small></div><p>{lead.scoreReason}</p><p className="subtitle">Confidence: {lead.researchConfidence ?? "unknown"}<br />Last researched: {lead.lastResearchedAt ? new Date(lead.lastResearchedAt).toLocaleString() : "Unknown"}</p><span className="status">{lead.status}</span>{lead.scoreComponents?.length ? <div className="score-breakdown">{lead.scoreComponents.map((component) => <div key={component.key}><b>+{component.points} · {component.key.replaceAll("_", " ")}</b><p>{component.reason}</p><small>{component.evidenceIds.length} evidence reference(s)</small></div>)}</div> : <p className="subtitle">No score provenance stored.</p>}</section>
      <section className="panel detail-block" style={{ marginTop: 18 }}><p className="panel-title">Tasks</p>{tasks.length ? tasks.map((task) => <p key={task.id}><b>{task.title}</b><br />{task.due} · {task.priority} priority</p>) : <p>No tasks yet.</p>}</section>
    </aside></div>
  </main>;
}
