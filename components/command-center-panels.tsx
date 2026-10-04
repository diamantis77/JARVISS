import Link from "next/link";
import { ArrowUpRight, CalendarDays, CheckCircle2, CircleDollarSign, Database, Mail, Search, Target, Waves } from "lucide-react";
import type { Activity, Approval, JarvisNotification, Lead, Task } from "@/types";
import type { BusinessFinancialSummary } from "@/lib/business-intelligence";
import { formatEur, resolveDealStage } from "@/lib/business-intelligence";
import { localizeStatus } from "@/lib/i18n";

export type CommandProviderStatus = { googleConnected: boolean; gmailConnected: boolean; calendarConnected: boolean };

const time = (value: string) => { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("el-GR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" }).format(parsed); };

export function TodayPanel({ leads, tasks, approvals, notifications, mode }: { leads: Lead[]; tasks: Task[]; approvals: Approval[]; notifications: JarvisNotification[]; mode: "demo" | "live" }) {
  const replies = notifications.filter((item) => ["EMAIL_REPLY", "HOT_LEAD_REPLY"].includes(item.type) && !item.dismissedAt).length;
  const meetings = notifications.filter((item) => ["MEETING_REQUEST", "UPCOMING_MEETING"].includes(item.type) && !item.dismissedAt).length;
  const metrics = [
    ["Νέα leads", leads.filter((lead) => lead.status === "new").length, "/leads?status=new"],
    ["Qualified", leads.filter((lead) => lead.status === "qualified").length, "/leads?status=qualified"],
    ["Απαντήσεις", replies, "/?command=Δείξε μου τις πρόσφατες απαντήσεις"],
    ["Meetings", meetings, "/?command=Τι έχω στο ημερολόγιο σήμερα;"],
    ["Εγκρίσεις", approvals.length, "/#approvals"],
    ["Ανοιχτές εργασίες", tasks.filter((task) => task.status === "open").length, "/#priorities"],
  ] as const;
  return <section className="cc-panel cc-today"><div className="cc-panel-head"><span>ΣΗΜΕΡΑ</span><small>{mode === "live" ? "LIVE SNAPSHOT" : "DEMO DATA"}</small></div><div className="today-metrics">{metrics.map(([label, value, href]) => <Link key={label} href={href}><span>{label}</span><b>{value}</b></Link>)}</div></section>;
}

export function PrioritiesPanel({ tasks, approvals, notifications }: { tasks: Task[]; approvals: Approval[]; notifications: JarvisNotification[] }) {
  const items = [
    ...approvals.slice(0, 2).map((item) => ({ id: `a-${item.id}`, label: item.subject || "Εκκρεμής έγκριση", meta: "ΑΠΑΙΤΕΙ ΕΓΚΡΙΣΗ", href: "/#approvals", tone: "amber" })),
    ...tasks.filter((task) => task.status === "open").sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - ({ high: 0, medium: 1, low: 2 }[b.priority]))).slice(0, 3).map((item) => ({ id: `t-${item.id}`, label: item.title, meta: item.due, href: "/?command=Δείξε μου τις ανοιχτές εργασίες", tone: "cyan" })),
    ...notifications.filter((item) => !item.readAt && ["urgent", "important"].includes(item.priority)).slice(0, 2).map((item) => ({ id: `n-${item.id}`, label: item.title, meta: item.body, href: "/", tone: "cyan" })),
  ].slice(0, 5);
  return <section className="cc-panel" id="priorities"><div className="cc-panel-head"><span>ΠΡΟΤΕΡΑΙΟΤΗΤΕΣ</span><Target size={13} /></div>{items.length ? <div className="priority-list">{items.map((item) => <Link key={item.id} href={item.href} className={item.tone}><i /><div><b>{item.label}</b><small>{item.meta}</small></div><ArrowUpRight size={12} /></Link>)}</div> : <p className="cc-empty">Δεν υπάρχουν άμεσες προτεραιότητες.</p>}</section>;
}

export function FinancePanel({ summary }: { summary: BusinessFinancialSummary }) {
  const metrics = [
    ["PIPELINE", formatEur(summary.pipelineValue)],
    ["ΕΚΤΙΜΩΜΕΝΑ ΕΣΟΔΑ", formatEur(summary.expectedRevenue)],
    ["ΚΛΕΙΣΜΕΝΑ ΕΣΟΔΑ", formatEur(summary.closedRevenue)],
    ["ΑΝΟΙΧΤΕΣ ΠΡΟΣΦΟΡΕΣ", String(summary.openProposals)],
    ["POTENTIAL DEALS", String(summary.potentialDeals)],
  ];
  return <section className="cc-panel finance-panel"><div className="cc-panel-head"><span>BUSINESS INTELLIGENCE</span><CircleDollarSign size={14} /></div><div className="finance-grid">{metrics.map(([label, value], index) => <div key={label} className={index === 0 ? "finance-primary" : ""}><small>{label}</small><strong className={!summary.hasFinancialData && index < 3 ? "insufficient" : ""}>{value}</strong></div>)}</div></section>;
}

export function PipelinePanel({ summary }: { summary: BusinessFinancialSummary }) {
  const maxCount = Math.max(1, ...summary.stages.map((stage) => stage.count));
  return <section className="cc-panel pipeline-panel"><div className="cc-panel-head"><span>SALES PIPELINE</span><Waves size={13} /></div><div className="pipeline-stages">{summary.stages.map((stage) => <div key={stage.stage}><span>{localizeStatus(stage.stage)}</span><i><em style={{ width: `${Math.max(stage.count ? 7 : 0, stage.count / maxCount * 100)}%` }} /></i><b>{stage.count}</b><small>{stage.value === null ? "—" : formatEur(stage.value)}</small></div>)}</div></section>;
}

export function OpportunityPanel({ leads }: { leads: Lead[] }) {
  const hot = [...leads].sort((a, b) => b.score - a.score).slice(0, 4);
  return <section className="cc-panel"><div className="cc-panel-head"><span>ΚΑΛΥΤΕΡΕΣ ΕΥΚΑΙΡΙΕΣ</span><Target size={13} /></div>{hot.length ? <div className="opportunity-list">{hot.map((lead) => <Link href={`/leads/${lead.id}`} key={lead.id}><div><b>{lead.businessName}</b><small>{typeof lead.estimatedValue === "number" ? `${formatEur(lead.estimatedValue)} · ${localizeStatus(resolveDealStage(lead))}` : localizeStatus(resolveDealStage(lead))}</small></div><strong>{lead.score}</strong></Link>)}</div> : <p className="cc-empty">Δεν υπάρχουν ακόμη CRM leads.</p>}</section>;
}

export function ClosingPanel({ summary }: { summary: BusinessFinancialSummary }) {
  return <section className="cc-panel"><div className="cc-panel-head"><span>ΚΟΝΤΑ ΣΤΟ ΚΛΕΙΣΙΜΟ</span><CheckCircle2 size={13} /></div>{summary.closeToClosing.length ? <div className="closing-list">{summary.closeToClosing.map((lead) => <Link href={`/leads/${lead.id}`} key={lead.id}><b>{lead.businessName}</b><span>{typeof lead.estimatedValue === "number" ? formatEur(lead.estimatedValue) : "Αξία μη διαθέσιμη"}</span><small>Στάδιο: {localizeStatus(resolveDealStage(lead))}</small></Link>)}</div> : <p className="cc-empty">Κανένα deal σε στάδιο προσφοράς ή διαπραγμάτευσης.</p>}</section>;
}

export function RecentActivityPanel({ activities }: { activities: Activity[] }) {
  return <section className="cc-panel activity-panel"><div className="cc-panel-head"><span>ΠΡΟΣΦΑΤΗ ΔΡΑΣΤΗΡΙΟΤΗΤΑ</span><small>{activities.length}</small></div>{activities.length ? <div className="cc-activity-list">{activities.slice(0, 6).map((item) => <div key={item.id}><time>{time(item.time)}</time><span><b>{item.title}</b><small>{item.description}</small></span></div>)}</div> : <p className="cc-empty">Δεν υπάρχει πρόσφατη δραστηριότητα.</p>}</section>;
}

export function ModulesPanel({ mode, voiceEnabled, wakeEnabled, researchMode, providers }: { mode: "demo" | "live"; voiceEnabled: boolean; wakeEnabled: boolean; researchMode: "demo" | "live" | "disabled"; providers: CommandProviderStatus }) {
  const modules = [
    ["ΦΩΝΗ", voiceEnabled, "voice", <Waves key="v" size={12} />], ["WAKE MODE", wakeEnabled, "wake", <Waves key="w" size={12} />], ["CRM", mode === "live", "crm", <Database key="c" size={12} />], ["ΕΡΕΥΝΑ", researchMode === "live", "research", <Search key="r" size={12} />], ["EMAIL", providers.gmailConnected, "email", <Mail key="e" size={12} />], ["ΗΜΕΡΟΛΟΓΙΟ", providers.calendarConnected, "calendar", <CalendarDays key="d" size={12} />],
  ] as const;
  return <section className="cc-panel modules-panel"><div className="cc-panel-head"><span>JARVIS STATUS</span><small>{mode === "live" ? "LIVE DATA" : "DEMO"}</small></div><div>{modules.map(([label, active, key, icon]) => <span key={key} className={active ? "module-on" : "module-off"}>{icon}<b>{label}</b><small>{active ? "ΕΝΕΡΓΟ" : "ΜΗ ΣΥΝΔΕΔΕΜΕΝΟ"}</small></span>)}</div></section>;
}
