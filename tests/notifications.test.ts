import { describe, expect, it } from "vitest";
import { createDemoRepositories } from "../lib/repositories/demo";
describe("notifications", () => {
  it("tracks unread/read state and isolates users", async () => { const a = createDemoRepositories(); const b = createDemoRepositories(); const first = (await a.notifications.list())[0]; await a.notifications.markRead(first.id); expect((await a.notifications.list())[0]?.readAt).toBeTruthy(); expect(await a.notifications.list(20, true)).toHaveLength(0); expect((await b.notifications.list())[0].readAt).toBeNull(); });
  it("deduplicates trusted backend events", async () => { const repositories = createDemoRepositories(); const input = { type: "EMAIL_REPLY" as const, priority: "important" as const, title: "Reply", body: "New reply", entityType: "email_thread", entityId: "t1", metadata: { dedupeKey: "gmail-m1" } }; await repositories.notifications.create(input); await repositories.notifications.create(input); expect((await repositories.notifications.list()).filter((item) => item.metadata.dedupeKey === "gmail-m1")).toHaveLength(1); });
});
