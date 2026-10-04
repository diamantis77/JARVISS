const publicPaths = ["/auth/sign-in", "/auth/sign-up", "/auth/forgot-password", "/auth/callback", "/auth/update-password"];
const signedProviderWebhookPaths = ["/api/webhooks/google/calendar", "/api/webhooks/google/gmail", "/api/telephony/twilio/voice", "/api/telephony/twilio/status", "/api/telephony/vonage/answer", "/api/telephony/vonage/event"];

export function isPublicAuthPath(pathname: string) {
  return publicPaths.some((path) => pathname.startsWith(path));
}

export function shouldProtectPath(pathname: string, liveMode: boolean) {
  if (!liveMode) return false;
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") return false;
  if (signedProviderWebhookPaths.some((path) => pathname === path)) return false;
  return !isPublicAuthPath(pathname);
}
