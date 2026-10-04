import { config } from "dotenv";
import { google } from "googleapis";
import { createAdminClient } from "../lib/supabase/admin";
import { createSupabaseRepositories } from "../lib/repositories/supabase";
import { authorizedGoogleClient } from "../lib/google/oauth";

config({ path: ".env.local", quiet: true });
let stage = "initialization";

async function main() {
  const runId = process.argv[2];
  if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("RUN_ID_REQUIRED");
  stage = "supabase-owner-read";
  const db = createAdminClient();
  const { data: run, error } = await db.from("jarvis_runs").select("user_id").eq("id", runId).maybeSingle();
  if (error || !run) throw new Error("OWNER_RUN_NOT_FOUND");
  const repositories = createSupabaseRepositories(db, run.user_id);
  stage = "google-oauth";
  const { auth, connection } = await authorizedGoogleClient(repositories, "gmail");
  stage = "gmail-profile";
  const profile = await google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
  console.log(`GMAIL_PROFILE_READ=ready ACCOUNT_MATCH=${profile.data.emailAddress?.trim().toLowerCase() === connection.providerEmail.trim().toLowerCase()}`);
}

main().catch((error: unknown) => { const status = error && typeof error === "object" && "code" in error ? String(error.code) : error && typeof error === "object" && "status" in error ? String(error.status) : "unknown"; console.log(`GMAIL_PROFILE_READ=failed STAGE=${stage} TYPE=${error instanceof Error ? error.name : typeof error} CODE=${status}`); process.exitCode = 1; });
