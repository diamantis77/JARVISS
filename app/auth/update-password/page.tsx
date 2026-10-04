import { AuthShell } from "@/components/auth/auth-shell";
import { AuthMessage } from "@/components/auth/auth-message";
import { updatePassword } from "@/app/auth/actions";
import { tr } from "@/lib/i18n";

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) { const params = await searchParams; return <AuthShell eyebrow={tr("Secure credential update")} title={tr("Choose a new password.")} description={tr("Use at least eight characters.")} footer={<span>Η συνεδρία ανάκτησης είναι προσωρινή.</span>}><AuthMessage error={params.error} /><form action={updatePassword} className="auth-form"><label>{tr("New password")}<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label><button className="primary auth-submit" type="submit">{tr("Update password")}</button></form></AuthShell>; }
