const publicPaths = ["/auth/sign-in", "/auth/sign-up", "/auth/forgot-password", "/auth/callback", "/auth/update-password"];

export function isPublicAuthPath(pathname: string) {
  return publicPaths.some((path) => pathname.startsWith(path));
}

export function shouldProtectPath(pathname: string, liveMode: boolean) {
  if (!liveMode) return false;
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") return false;
  return !isPublicAuthPath(pathname);
}
