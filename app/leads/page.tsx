import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Filter } from "lucide-react";
import { LeadsTable } from "@/components/leads-table";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { tr } from "@/lib/i18n";
import type { LeadStatus } from "@/types";

export const dynamic = "force-dynamic";
const statuses = new Set<LeadStatus>(["new", "analyzed", "qualified", "contacted", "interested", "meeting", "won", "lost"]);

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const context = await createRequestRepositories();
  if (!context) redirect("/auth/sign-in");
  const requestedStatus = (await searchParams).status;
  const status = requestedStatus && statuses.has(requestedStatus as LeadStatus) ? requestedStatus as LeadStatus : null;
  const allLeads = await context.repositories.leads.list();
  const leads = status ? allLeads.filter((lead) => lead.status === status) : allLeads;
  return <main className="page"><Link href="/" className="subtitle"><ArrowLeft size={13} /> {tr("Command center")}</Link><div className="page-head"><div><h1>{tr("Leads workspace")}</h1><p className="subtitle">{tr(context.mode === "demo" ? "Demo CRM · fictional records only." : "Private CRM · scoped to your authenticated account.")}</p></div>{status ? <Link href="/leads" className="secondary"><Filter size={12} /> {tr("Clear filter")}: {tr(status)}</Link> : <span className="secondary"><Filter size={12} /> {tr("All leads")}</span>}</div>{leads.length ? <LeadsTable leads={leads} /> : <section className="panel empty">{status ? `Δεν υπάρχουν leads με κατάσταση «${tr(status)}».` : tr("No leads yet. Ask JARVIS to save a verified lead.")}</section>}</main>;
}
