import { describe, expect, it, vi } from "vitest";
import { loadMissionDashboard } from "../lib/missions/client-load";

describe("Daily Missions client loading", () => {
  it("resolves an authenticated empty response", async () => {
    const fetcher = vi.fn(async () => Response.json({ available: true, missions: [], phoneNotificationsEnabled: false }));
    expect(await loadMissionDashboard(undefined, fetcher as typeof fetch)).toEqual({
      kind: "ready", data: { available: true, missions: [], phoneNotificationsEnabled: false },
    });
    expect(fetcher).toHaveBeenCalledWith("/api/missions", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
  });

  it("distinguishes authentication and API errors from an empty mission list", async () => {
    const auth = vi.fn(async () => Response.json({ error: "Sign in required" }, { status: 401 }));
    expect(await loadMissionDashboard(undefined, auth as typeof fetch)).toEqual({ kind: "auth" });
    const failed = vi.fn(async () => Response.json({ error: "Missions are temporarily unavailable" }, { status: 503 }));
    expect(await loadMissionDashboard(undefined, failed as typeof fetch)).toEqual({
      kind: "error", message: "Missions are temporarily unavailable",
    });
  });

  it("turns a stalled request into a finite timeout error", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    expect(await loadMissionDashboard(undefined, fetcher as typeof fetch, 5)).toEqual({
      kind: "error", message: "Η ανάγνωση αποστολών δεν ολοκληρώθηκε εντός του χρονικού ορίου.",
    });
  });
});
