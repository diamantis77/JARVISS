import { google } from "googleapis";
import type { Repositories } from "../repositories/contracts";
import type { ProviderCapability, ProviderConnection } from "../../types";
import { decryptToken, encryptToken } from "./token-crypto";
import { hasCapability } from "./scopes";

export function googleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID; const clientSecret = process.env.GOOGLE_CLIENT_SECRET; const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google OAuth is not configured");
  const redirect = new URL(redirectUri); if (!/^https?:$/.test(redirect.protocol) || redirect.username || redirect.password || redirect.hash) throw new Error("Invalid Google redirect URI");
  return new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
}

const refreshLocks = new Map<string, Promise<ReturnType<typeof googleOAuthClient>>>();
async function buildAuthorizedClient(repositories: Repositories, connection: ProviderConnection) {
  const client = googleOAuthClient();
  client.setCredentials({ access_token: connection.accessTokenEncrypted ? decryptToken(connection.accessTokenEncrypted) : undefined, refresh_token: connection.refreshTokenEncrypted ? decryptToken(connection.refreshTokenEncrypted) : undefined, expiry_date: connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt).getTime() : undefined, scope: connection.scopes.join(" ") });
  client.on("tokens", (tokens) => { void repositories.connections.update(connection.id, { accessTokenEncrypted: tokens.access_token ? encryptToken(tokens.access_token) : connection.accessTokenEncrypted, refreshTokenEncrypted: tokens.refresh_token ? encryptToken(tokens.refresh_token) : connection.refreshTokenEncrypted, tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : connection.tokenExpiresAt }); });
  await client.getAccessToken();
  return client;
}

export async function authorizedGoogleClient(repositories: Repositories, capability: ProviderCapability) {
  const connection = await repositories.connections.getGoogle();
  if (!connection || connection.status !== "connected" || !hasCapability(connection.scopes, capability)) throw new Error(`${capability} is not connected`);
  let pending = refreshLocks.get(connection.id);
  if (!pending) { pending = buildAuthorizedClient(repositories, connection); refreshLocks.set(connection.id, pending); pending.finally(() => refreshLocks.delete(connection.id)).catch(() => undefined); }
  try { return { auth: await pending, connection }; }
  catch {
    await repositories.connections.update(connection.id, { status: "needs_reconnect", errorCode: "TOKEN_REFRESH_FAILED", errorMessage: "Google authorization expired. Reconnect required." });
    await repositories.notifications.create({ type: "PROVIDER_ERROR", priority: "urgent", title: "Google connection needs attention", body: "Reconnect Google to restore Gmail and Calendar access.", entityType: "provider_connection", entityId: connection.id, metadata: { dedupeKey: `google-reconnect-${connection.id}` } });
    throw new Error("Google authorization expired. Reconnect required.");
  }
}
