import type { NextConfig } from "next";

// Keep development chunks separate from production builds. Running `next build`
// while the local dev stack is up must not replace files used by its browser.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.PLAYWRIGHT_E2E === "1" ? ".next-e2e" : process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  ...(process.env.JARVIS_DESKTOP_BUILD === "1" ? { output: "standalone" as const } : {}),
};
export default nextConfig;
