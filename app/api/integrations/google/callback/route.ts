import { cookies } from "next/headers";
import { google } from "googleapis";
import { createRequestRepositories } from "@/lib/repositories/factory";
import { googleOAuthClient } from "@/lib/google/oauth";
import { encryptToken } from "@/lib/google/token-crypto";
import { validOAuthState } from "@/lib/google/oauth-state";

const settings = (status: string) => Response.redirect(new URL(`/settings?google=${status}`, process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000"));

export async function GET(request: Request) {
  const context = await createRequestRepositories(); if (!context || context.mode !== "live") return settings("session-expired");
  const url = new URL(request.url); const jar = await cookies(); const expected = jar.get("jarvis_google_oauth_state")?.value; const verifier = jar.get("jarvis_google_oauth_verifier")?.value;
  jar.delete("jarvis_google_oauth_state"); jar.delete("jarvis_google_oauth_verifier"); jar.delete("jarvis_google_oauth_capability");
  if (!verifier || !validOAuthState(expected, url.searchParams.get("state"))) return settings("invalid-state");
  const code = url.searchParams.get("code"); if (!code) return settings("denied");
  try {
    const client = googleOAuthClient(); const { tokens } = await client.getToken({ code, codeVerifier: verifier }); client.setCredentials(tokens);
    const profile = await google.oauth2({ version: "v2", auth: client }).userinfo.get(); if (!profile.data.id || !profile.data.email) throw new Error("Google account identity unavailable");
    const existing = await context.repositories.connections.getGoogle(); const sameAccount = existing?.providerAccountId === profile.data.id; const scopes = [...new Set([...(sameAccount ? existing.scopes : []), ...(tokens.scope?.split(" ").filter(Boolean) ?? [])])];
    await context.repositories.connections.upsertGoogle({ provider: "google", providerAccountId: profile.data.id, providerEmail: profile.data.email, status: "connected", scopes, accessTokenEncrypted: tokens.access_token ? encryptToken(tokens.access_token) : sameAccount ? existing.accessTokenEncrypted : null, refreshTokenEncrypted: tokens.refresh_token ? encryptToken(tokens.refresh_token) : sameAccount ? existing.refreshTokenEncrypted : null, tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null, lastSyncAt: sameAccount ? existing.lastSyncAt : null, errorCode: null, errorMessage: null });
    return settings("connected");
  } catch { return settings("failed"); }
}
