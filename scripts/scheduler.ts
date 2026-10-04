import { loadEnvConfig } from "@next/env";
import { createAdminClient } from "../lib/supabase/admin";
import { SupabaseJobQueue } from "../lib/jobs/supabase-queue";
import { ProductionScheduler } from "../lib/jobs/scheduler";
import { waitWithoutTimer } from "../lib/jobs/worker";

loadEnvConfig(process.cwd());

async function main() {
  const once = process.argv.includes("--once");
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const schedulerId = process.env.SCHEDULER_ID || `scheduler-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  if (!configured) {
    console.info(JSON.stringify({ service: "scheduler", mode: "demo", status: "idle", detail: "Supabase is not configured; no production schedules are registered." }));
    return;
  }

  const db = createAdminClient();
  const scheduler = new ProductionScheduler(db, new SupabaseJobQueue(db), schedulerId);
  let stopping = false;
  let sleepController: AbortController | null = null;
  const stop = () => { stopping = true; sleepController?.abort(); };
  const pause = async (milliseconds: number) => {
    sleepController = new AbortController();
    try { await waitWithoutTimer(milliseconds, sleepController.signal); }
    catch (error) { if (!stopping) throw error; }
    finally { sleepController = null; }
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  if (process.env.JARVIS_DESKTOP_SESSION) {
    process.on("message", (message) => { if (message === "jarvis-desktop-shutdown") stop(); });
    process.once("disconnect", stop);
  }
  console.info(JSON.stringify({ service: "scheduler", schedulerId, status: "started", once }));

  do {
    try {
      const result = await scheduler.runOnce();
      console.info(JSON.stringify({ service: "scheduler", schedulerId, status: "tick", ...result }));
      if (!once && !stopping) await pause(60_000);
    } catch (error) {
      if (once) throw error;
      console.error(JSON.stringify({ service: "scheduler", schedulerId, status: "degraded", error: error instanceof Error ? error.message : "Scheduler tick failed", retrying: true }));
      if (!stopping) await pause(10_000);
    }
  } while (!once && !stopping);

  console.info(JSON.stringify({ service: "scheduler", schedulerId, status: "stopped" }));
}

void main().catch((error) => {
  console.error(JSON.stringify({ service: "scheduler", status: "failed", error: error instanceof Error ? error.message : "Scheduler failed" }));
  process.exitCode = 1;
});
