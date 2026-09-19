import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Filter } from "lucide-react";
import { LeadsTable } from "@/components/leads-table";
import { createRequestRepositories } from "@/lib/repositories/factory";

export const dynamic = "force-dynamic";
export default async function LeadsPage() { const context = await createRequestRepositories(); if (!context) redirect("/auth/sign-in"); const leads = await context.repositories.leads.list(); return <main className="page"><Link href="/" className="subtitle"><ArrowLeft size={13} /> Command center</Link><div className="page-head"><div><h1>Leads workspace</h1><p className="subtitle">{context.mode === "demo" ? "Demo CRM · fictional records only." : "Private CRM · scoped to your authenticated account."}</p></div><button className="secondary"><Filter size={12} /> Filters</button></div>{leads.length ? <LeadsTable leads={leads} /> : <section className="panel empty">No leads yet. Ask JARVIS to save a verified lead.</section>}</main>; }
