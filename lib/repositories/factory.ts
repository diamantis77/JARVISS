import "server-only";
import { getRuntimeMode } from "@/lib/config/runtime";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { getDemoRepositories } from "@/lib/repositories/demo";
import { createSupabaseRepositories } from "@/lib/repositories/supabase";

export async function createRequestRepositories() {
  if (getRuntimeMode() === "demo") return { mode: "demo" as const, userId: "demo-user", repositories: getDemoRepositories() };
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase || !user) return null;
  return { mode: "live" as const, userId: user.id, repositories: createSupabaseRepositories(supabase, user.id) };
}
