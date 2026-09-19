import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthMessage } from "@/components/auth/auth-message";
import { signUp } from "@/app/auth/actions";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) { const params = await searchParams; return <AuthShell eyebrow="Operator enrollment" title="Initialize JARVIS." description="Create your private workspace and encrypted session." footer={<><span>Already enrolled?</span> <Link href="/auth/sign-in">Sign in</Link></>}><AuthMessage error={params.error} /><form action={signUp} className="auth-form"><label>Your name<input name="fullName" required autoComplete="name" /></label><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Password<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label><button className="primary auth-submit" type="submit">Create secure workspace</button></form></AuthShell>; }
