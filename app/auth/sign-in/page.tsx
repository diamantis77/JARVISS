import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthMessage } from "@/components/auth/auth-message";
import { signIn } from "@/app/auth/actions";
import { getRuntimeMode } from "@/lib/config/runtime";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string; next?: string }> }) {
  const params = await searchParams; const demo = getRuntimeMode() === "demo";
  return <AuthShell eyebrow="Identity gateway" title="Welcome back." description="Sign in to reconnect JARVIS with your business memory." footer={<><span>New operator?</span> <Link href="/auth/sign-up">Create account</Link></>}><AuthMessage error={params.error} message={params.message} />{demo && <div className="auth-message">Supabase is not configured. <Link href="/">Continue in clearly labelled Demo Mode.</Link></div>}<form action={signIn} className="auth-form"><input type="hidden" name="next" value={params.next ?? "/"} /><label>Email<input name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></label><label>Password<input name="password" type="password" autoComplete="current-password" required minLength={8} /></label><div className="auth-row"><Link href="/auth/forgot-password">Forgot password?</Link></div><button className="primary auth-submit" type="submit" disabled={demo}>Enter command center</button></form></AuthShell>;
}
