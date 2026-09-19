import Link from "next/link";
import { Sparkles } from "lucide-react";

export function AuthShell({ eyebrow, title, description, children, footer }: { eyebrow: string; title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  return <main className="auth-page"><section className="auth-visual"><Link href="/" className="wordmark"><span className="mark"><Sparkles size={16} /></span>JARVIS</Link><div className="auth-orbit"><span /><span /><i /></div><div><p className="panel-title">SECURE BUSINESS OPERATING SYSTEM</p><h2>One intelligence.<br />Every operation.</h2><p>Authenticated memory, constrained tools, and explicit approval for every external action.</p></div></section><section className="auth-card panel"><p className="panel-title">{eyebrow}</p><h1>{title}</h1><p className="subtitle">{description}</p>{children}<div className="auth-footer">{footer}</div></section></main>;
}
