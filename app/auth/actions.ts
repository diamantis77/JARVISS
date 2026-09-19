"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function messageUrl(path: string, key: "error" | "message", value: string) {
  return `${path}?${key}=${encodeURIComponent(value)}`;
}

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect(messageUrl("/auth/sign-in", "error", "Supabase is not configured. JARVIS is running in Demo Mode."));
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextValue = String(formData.get("next") ?? "/");
  const next = nextValue.startsWith("/") && !nextValue.startsWith("//") ? nextValue : "/";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(messageUrl("/auth/sign-in", "error", "Unable to sign in. Check your email and password."));
  redirect(next);
}

export async function signUp(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect(messageUrl("/auth/sign-up", "error", "Supabase is not configured."));
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback`, data: { full_name: fullName } },
  });
  if (error) redirect(messageUrl("/auth/sign-up", "error", error.message));
  if (!data.session) redirect(messageUrl("/auth/sign-in", "message", "Check your email to confirm your JARVIS account."));
  redirect("/onboarding");
}

export async function requestPasswordReset(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect(messageUrl("/auth/forgot-password", "error", "Supabase is not configured."));
  const email = String(formData.get("email") ?? "").trim();
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/update-password` });
  redirect(messageUrl("/auth/sign-in", "message", "If an account exists, a password reset link has been sent."));
}

export async function updatePassword(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect(messageUrl("/auth/update-password", "error", "Supabase is not configured."));
  const password = String(formData.get("password") ?? "");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(messageUrl("/auth/update-password", "error", "Your password could not be updated."));
  redirect(messageUrl("/auth/sign-in", "message", "Password updated. Sign in with your new password."));
}

export async function signOut() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  redirect("/auth/sign-in");
}
