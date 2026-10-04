"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, ClipboardList, FileText, FlaskConical, Home, Mail, Mic, Phone, Plus, Search, Settings2, Target, Users } from "lucide-react";
import type { Lead, Task } from "@/types";
import type { MissionDashboardData } from "@/lib/missions/dashboard";
import { localizeStatus } from "@/lib/i18n";

const navigation = [
  { href: "/", label: "Αρχική", icon: Home },
  { href: "/operations", label: "Missions", icon: Target },
  { href: "/operations", label: "Έρευνα", icon: FlaskConical },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/#approvals", label: "Εγκρίσεις", icon: ClipboardList },
  { href: "/operations", label: "Κλήσεις", icon: Phone },
  { href: "/settings", label: "Ρυθμίσεις", icon: Settings2 },
];

export function CommandRail() {
  return <nav className="hud-rail" aria-label="Πλοήγηση JARVIS">{navigation.map(({ href, label, icon: Icon }, index) => <Link className={index === 0 ? "hud-rail-active" : ""} href={href} key={label} title={label}><Icon size={20} strokeWidth={1.6} /><span>{label}</span></Link>)}</nav>;
}

export function MissionHud({ mode }: { mode: "demo" | "live" }) {
  const [data, setData] = useState<MissionDashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (mode !== "live") return;
    let mounted = true;
    const refresh = async () => {
      try {
        const result = await fetch("/api/missions", { cache: "no-store" });
        if (!result.ok) throw new Error("Mission snapshot unavailable");
        const next = await result.json() as MissionDashboardData;
        if (mounted) { setData(next); setFailed(false); }
      } catch { if (mounted) setFailed(true); }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, [mode]);
  const snapshot = data?.missions.find((item) => item.mission.status === "active") ?? data?.missions[0];
  const target = snapshot?.mission.dailyTargetLimit ?? 0;
  const qualified = snapshot?.metrics.qualified ?? 0;
  return <section className="cc-panel hud-mission"><div className="cc-panel-head"><span>ΤΡΕΧΟΥΣΑ ΑΠΟΣΤΟΛΗ</span><Link href="/operations">Προβολή ↗</Link></div>
    {snapshot ? <><div className="hud-mission-title"><Target size={18} /><b>{snapshot.mission.title}</b></div><div className="hud-progress"><i style={{ width: `${target ? Math.min(100, qualified / target * 100) : 0}%` }} /></div><div className="hud-mission-meta"><span>{localizeStatus(snapshot.mission.status)}</span><b>{qualified} / {target}</b></div><p>{snapshot.nextAction}</p></> : <div className="hud-empty">{mode === "demo" ? "Οι πραγματικές αποστολές δεν εμφανίζονται σε Demo Mode." : failed || data?.available === false ? "Τα δεδομένα αποστολών δεν είναι διαθέσιμα." : data ? "Δεν υπάρχει ενεργή αποστολή." : "Φόρτωση αποστολών…"}</div>}
  </section>;
}

export function QuickActionsHud({ onMic }: { onMic: () => void }) {
  const actions = [
    { href: "/operations", label: "Νέα αποστολή", icon: Plus },
    { href: "/operations", label: "Έρευνα", icon: Search },
    { href: "/settings", label: "Email", icon: Mail },
    { href: "/operations", label: "Κλήσεις", icon: Phone },
    { href: "/settings", label: "Ημερολόγιο", icon: CalendarDays },
    { href: "/leads", label: "Leads", icon: Users },
    { href: "/#priorities", label: "Εργασίες", icon: ClipboardList },
    { href: "/operations", label: "Αναφορές", icon: FileText },
  ];
  return <section className="cc-panel hud-actions"><div className="cc-panel-head"><span>ΓΡΗΓΟΡΕΣ ΕΝΕΡΓΕΙΕΣ</span></div><div>{actions.map(({ href, label, icon: Icon }) => <Link href={href} key={label}><Icon size={23} strokeWidth={1.5} /><span>{label}</span></Link>)}</div><button type="button" onClick={onMic}><Mic size={15} /> Έναρξη φωνής</button></section>;
}

export function LeadHud({ leads }: { leads: Lead[] }) {
  const qualified = leads.filter((lead) => lead.status === "qualified").length;
  const needsReview = leads.filter((lead) => lead.status === "new" || lead.status === "analyzed").length;
  const recent = [...leads].sort((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity)).slice(0, 4);
  return <><section className="cc-panel hud-leads"><div className="cc-panel-head"><span>LEADS · CRM</span><Link href="/leads">Προβολή όλων ↗</Link></div><div className="hud-leads-main"><div className="hud-donut" style={{ "--hud-ratio": `${leads.length ? qualified / leads.length * 100 : 0}%` } as React.CSSProperties}><b>{qualified}</b><small>/ {leads.length}</small></div><div className="hud-leads-legend"><span><i className="qualified" />Qualified <b>{qualified}</b></span><span><i className="review" />Για έλεγχο <b>{needsReview}</b></span><span><i className="other" />Λοιπά <b>{leads.length - qualified - needsReview}</b></span></div></div></section><section className="cc-panel hud-recent"><div className="cc-panel-head"><span>ΠΡΟΣΦΑΤΑ LEADS</span><Link href="/leads">Προβολή όλων ↗</Link></div>{recent.length ? recent.map((lead) => <Link href={`/leads/${lead.id}`} key={lead.id}><span className="hud-avatar">{lead.businessName.slice(0, 1)}</span><span><b>{lead.businessName}</b><small>{lead.category} · {lead.city}</small></span><em>{localizeStatus(lead.status)}</em></Link>) : <p className="hud-empty">Δεν υπάρχουν ακόμη CRM leads.</p>}</section></>;
}

export function ScheduleHud({ tasks }: { tasks: Task[] }) {
  const open = tasks.filter((task) => task.status === "open").slice(0, 5);
  return <section className="cc-panel hud-schedule"><div className="cc-panel-head"><span>ΕΚΚΡΕΜΕΙΣ ΕΡΓΑΣΙΕΣ</span><Link href="/#priorities">↗</Link></div>{open.length ? <div>{open.map((task) => <div key={task.id}><time>{task.due || "—"}</time><i /><span>{task.title}</span></div>)}</div> : <p className="hud-empty">Δεν υπάρχουν ανοιχτές εργασίες.</p>}</section>;
}
