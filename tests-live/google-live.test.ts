import { describe, expect, it } from "vitest";
import { google } from "googleapis";
import { googleOAuthClient } from "../lib/google/oauth";

const enabled = process.env.RUN_LIVE_GOOGLE_TESTS === "true";
describe.skipIf(!enabled)("explicit read-only Google integration", () => {
  it("reads the dedicated test account Gmail profile and Calendar metadata", async () => { const refreshToken = process.env.GOOGLE_LIVE_TEST_REFRESH_TOKEN; if (!refreshToken) throw new Error("GOOGLE_LIVE_TEST_REFRESH_TOKEN is required for the explicitly enabled live test"); const auth = googleOAuthClient(); auth.setCredentials({ refresh_token: refreshToken }); const [profile, calendars] = await Promise.all([google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" }), google.calendar({ version: "v3", auth }).calendarList.list({ maxResults: 1 })]); expect(profile.data.emailAddress).toContain("@"); expect(Array.isArray(calendars.data.items ?? [])).toBe(true); });
});
