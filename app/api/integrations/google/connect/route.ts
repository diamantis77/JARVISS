import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { CodeChallengeMethod } from "google-auth-library";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { googleOAuthClient } from "@/lib/google/oauth";
import { scopesFor } from "@/lib/google/scopes";
import type { ProviderCapability } from "@/types";

export async function GET(request: Request) {
  const context = await createRequestRepositories();
  if (!context || context.mode !== "live") return Response.json({ error: "Google connections require authenticated Live Mode." }, { status: 401 });
  const capability = new URL(request.url).searchParams.get("capability") as ProviderCapability | null;
  if (capability !== "gmail" && capability !== "calendar") return Response.json({ error: "Choose Gmail or Calendar." }, { status: 400 });
  if (capability === "gmail" && process.env.GOOGLE_GMAIL_ENABLED !== "true" || capability === "calendar" && process.env.GOOGLE_CALENDAR_ENABLED !== "true") return Response.json({ error: `${capability} integration is disabled.` }, { status: 503 });
  const state = randomBytes(32).toString("base64url"); const verifier = randomBytes(48).toString("base64url"); const challenge = createHash("sha256").update(verifier).digest("base64url");
  const jar = await cookies(); const secure = process.env.NODE_ENV === "production";
  jar.set("jarvis_google_oauth_state", state, { httpOnly: true, secure, sameSite: "lax", path: "/api/integrations/google/callback", maxAge: 600 });
  jar.set("jarvis_google_oauth_verifier", verifier, { httpOnly: true, secure, sameSite: "lax", path: "/api/integrations/google/callback", maxAge: 600 });
  jar.set("jarvis_google_oauth_capability", capability, { httpOnly: true, secure, sameSite: "lax", path: "/api/integrations/google/callback", maxAge: 600 });
  const url = googleOAuthClient().generateAuthUrl({ access_type: "offline", include_granted_scopes: true, prompt: "consent select_account", scope: scopesFor(capability), state, code_challenge: challenge, code_challenge_method: CodeChallengeMethod.S256 });
  return Response.redirect(url);
}
