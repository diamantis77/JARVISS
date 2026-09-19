import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthMessage } from "@/components/auth/auth-message";
import { requestPasswordReset } from "@/app/auth/actions";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) { const params = await searchParams; return <AuthShell eyebrow="Access recovery" title="Reset access." description="We will send a secure recovery link if the account exists." footer={<Link href="/auth/sign-in">Return to sign in</Link>}><AuthMessage error={params.error} /><form action={requestPasswordReset} className="auth-form"><label>Email<input name="email" type="email" required autoComplete="email" /></label><button className="primary auth-submit" type="submit">Send recovery link</button></form></AuthShell>; }
