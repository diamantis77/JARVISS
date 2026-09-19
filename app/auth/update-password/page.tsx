import { AuthShell } from "@/components/auth/auth-shell";
import { AuthMessage } from "@/components/auth/auth-message";
import { updatePassword } from "@/app/auth/actions";

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) { const params = await searchParams; return <AuthShell eyebrow="Secure credential update" title="Choose a new password." description="Use at least eight characters." footer={<span>Your recovery session is temporary.</span>}><AuthMessage error={params.error} /><form action={updatePassword} className="auth-form"><label>New password<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label><button className="primary auth-submit" type="submit">Update password</button></form></AuthShell>; }
