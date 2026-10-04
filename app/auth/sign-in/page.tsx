import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthMessage } from "@/components/auth/auth-message";
import { signIn } from "@/app/auth/actions";
import { getRuntimeMode } from "@/lib/config/runtime";
import { tr } from "@/lib/i18n";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string; next?: string }> }) {
  const params = await searchParams; const demo = getRuntimeMode() === "demo";
  return <AuthShell eyebrow={tr("Identity gateway")} title={tr("Welcome back.")} description={tr("Sign in to reconnect JARVIS with your business memory.")} footer={<><span>{tr("New operator?")}</span> <Link href="/auth/sign-up">{tr("Create account")}</Link></>}><AuthMessage error={params.error} message={params.message} />{demo && <div className="auth-message">Το Supabase δεν έχει ρυθμιστεί. <Link href="/">Συνέχεια σε σαφώς επισημασμένο Demo Mode.</Link></div>}<form action={signIn} className="auth-form"><input type="hidden" name="next" value={params.next ?? "/"} /><label>{tr("Email")}<input name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></label><label>{tr("Password")}<input name="password" type="password" autoComplete="current-password" required minLength={8} /></label><div className="auth-row"><Link href="/auth/forgot-password">{tr("Forgot password?")}</Link></div><button className="primary auth-submit" type="submit" disabled={demo}>{tr("Enter command center")}</button></form></AuthShell>;
}
