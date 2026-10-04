import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthMessage } from "@/components/auth/auth-message";
import { signUp } from "@/app/auth/actions";
import { tr } from "@/lib/i18n";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) { const params = await searchParams; return <AuthShell eyebrow={tr("Operator enrollment")} title={tr("Initialize JARVIS.")} description={tr("Create your private workspace and encrypted session.")} footer={<><span>{tr("Already enrolled?")}</span> <Link href="/auth/sign-in">{tr("Sign in")}</Link></>}><AuthMessage error={params.error} /><form action={signUp} className="auth-form"><label>{tr("Your name")}<input name="fullName" required autoComplete="name" /></label><label>{tr("Email")}<input name="email" type="email" required autoComplete="email" /></label><label>{tr("Password")}<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label><button className="primary auth-submit" type="submit">{tr("Create secure workspace")}</button></form></AuthShell>; }
