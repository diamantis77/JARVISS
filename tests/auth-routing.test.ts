import { describe, expect, it } from "vitest";
import { shouldProtectPath } from "../lib/security/auth-routing";

describe("authenticated route protection", () => {
  it("protects application and API routes in live mode", () => { expect(shouldProtectPath("/", true)).toBe(true); expect(shouldProtectPath("/api/jarvis/run", true)).toBe(true); });
  it("keeps auth routes public and demo mode accessible", () => { expect(shouldProtectPath("/auth/sign-in", true)).toBe(false); expect(shouldProtectPath("/leads", false)).toBe(false); });
});
