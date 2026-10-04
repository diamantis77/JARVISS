/** Next can report an internal localhost URL even when the local browser used 127.0.0.1. */
export function matchesGoogleCallbackUrl(request: Request, configuredRedirectUri: string | undefined, environment = process.env.NODE_ENV): boolean {
  if (!configuredRedirectUri) return false;
  let actual: URL;
  let configured: URL;
  try {
    actual = new URL(request.url);
    configured = new URL(configuredRedirectUri);
  } catch {
    return false;
  }
  if (actual.pathname !== configured.pathname) return false;
  if (actual.origin === configured.origin) return true;

  // This exception is local-development only. The browser's Host must still
  // match the configured OAuth callback exactly; production stays strict.
  if (environment !== "development" || !["127.0.0.1", "localhost"].includes(configured.hostname)) return false;
  return actual.protocol === configured.protocol && request.headers.get("host")?.toLowerCase() === configured.host.toLowerCase();
}
