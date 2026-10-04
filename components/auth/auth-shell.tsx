import Link from "next/link";
import { Sparkles } from "lucide-react";
import { tr } from "@/lib/i18n";

export function AuthShell({ eyebrow, title, description, children, footer }: { eyebrow: string; title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  return <main className="auth-page"><section className="auth-visual"><Link href="/" className="wordmark"><span className="mark"><Sparkles size={16} /></span>JARVIS</Link><div className="auth-orbit"><span /><span /><i /></div><div><p className="panel-title">{tr("SECURE BUSINESS OPERATING SYSTEM")}</p><h2>Μία νοημοσύνη.<br />Κάθε λειτουργία.</h2><p>{tr("Authenticated memory, constrained tools, and explicit approval for every external action.")}</p></div></section><section className="auth-card panel"><p className="panel-title">{eyebrow}</p><h1>{title}</h1><p className="subtitle">{description}</p>{children}<div className="auth-footer">{footer}</div></section></main>;
}
