import Link from "next/link";
import type { Lead } from "@/types";
import { localizeStatus, tr } from "@/lib/i18n";
export function LeadsTable({ leads }: { leads: Lead[] }) {
  return <div className="panel table-wrap"><table className="leads-table"><thead><tr>{["Business", "Industry", "Location", "Score", "Status", "Website", "Opportunity", "Last activity"].map((key) => <th key={key}>{tr(key)}</th>)}</tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><Link href={`/leads/${lead.id}`} className="lead-name">{lead.businessName}</Link></td><td>{lead.category}</td><td>{lead.city}</td><td><span className="score">{lead.score}/100</span></td><td><span className="status">{localizeStatus(lead.status)}</span></td><td><span className="badge">{tr(lead.website ? "Listed" : "Unknown")}</span></td><td>{lead.opportunitySummary}</td><td>{lead.lastActivity}</td></tr>)}</tbody></table></div>;
}
