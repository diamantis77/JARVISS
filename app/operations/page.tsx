import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { OperationsDashboard } from "@/components/operations-dashboard";
export const dynamic = "force-dynamic";
export default async function OperationsPage() { const context = await createRequestRepositories(); if (!context) redirect("/auth/sign-in"); const snapshot = await context.repositories.operations.snapshot(); return <main className="page"><Link href="/" className="subtitle"><ArrowLeft size={13} /> Command center</Link><div className="page-head"><div><h1>System / Operations</h1><p className="subtitle">Durable jobs, provider health and actionable failures.</p></div></div><OperationsDashboard initial={snapshot} /></main>; }
