import type { MissionDashboardData } from "./dashboard";

export type MissionViewState =
  | { kind: "loading" }
  | { kind: "ready"; data: MissionDashboardData }
  | { kind: "auth" }
  | { kind: "error"; message: string };

export async function loadMissionDashboard(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<MissionViewState> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher("/api/missions", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
    if (response.status === 401 || response.redirected && response.url.includes("/auth/sign-in")) return { kind: "auth" };
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      return { kind: "error", message: body?.error ?? `Η υπηρεσία αποστολών επέστρεψε HTTP ${response.status}.` };
    }
    return { kind: "ready", data: await response.json() as MissionDashboardData };
  } catch {
    return { kind: "error", message: controller.signal.aborted && !signal?.aborted ? "Η ανάγνωση αποστολών δεν ολοκληρώθηκε εντός του χρονικού ορίου." : "Αποτυχία σύνδεσης με την υπηρεσία αποστολών." };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
