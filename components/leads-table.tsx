import Link from "next/link";
import type { Lead } from "@/types";
export function LeadsTable({ leads }: { leads: Lead[] }) {
  return <div className="panel table-wrap"><table className="leads-table"><thead><tr><th>Business</th><th>Industry</th><th>Location</th><th>Score</th><th>Status</th><th>Website</th><th>Opportunity</th><th>Last activity</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><Link href={`/leads/${lead.id}`} className="lead-name">{lead.businessName}</Link></td><td>{lead.category}</td><td>{lead.city}</td><td><span className="score">{lead.score}/100</span></td><td><span className="status">{lead.status}</span></td><td><span className="badge">{lead.website ? "Listed" : "Unknown"}</span></td><td>{lead.opportunitySummary}</td><td>{lead.lastActivity}</td></tr>)}</tbody></table></div>;
}
