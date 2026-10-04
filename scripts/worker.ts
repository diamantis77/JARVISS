import { loadEnvConfig } from "@next/env";
import { createAdminClient } from "../lib/supabase/admin";
import { SupabaseJobQueue } from "../lib/jobs/supabase-queue";
import { runWorkerOnce, waitWithoutTimer } from "../lib/jobs/worker";

loadEnvConfig(process.cwd());

async function main() {
  const once = process.argv.includes("--once");
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const workerId = process.env.JOB_WORKER_ID || `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  if (!configured) {
    console.info(JSON.stringify({ service: "worker", mode: "demo", status: "idle", detail: "Supabase is not configured; no external background work is executed." }));
    return;
  }

  const db = createAdminClient();
  const queue = new SupabaseJobQueue(db);
  let stopping = false;
  let readyLogged = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  if (process.env.JARVIS_DESKTOP_SESSION) {
    process.on("message", (message) => { if (message === "jarvis-desktop-shutdown") stopping = true; });
    process.once("disconnect", () => { stopping = true; });
  }
  console.info(JSON.stringify({ service: "worker", workerId, status: "started", once }));

  do {
    try {
      const heartbeat = await db.from("operation_runtime").upsert({ runtime_id: workerId, runtime_type: "worker", version: "0.6.0", last_seen_at: new Date().toISOString(), metadata: { pid: process.pid } });
      if (heartbeat.error) throw new Error("Worker heartbeat failed");
      if (process.env.JARVIS_DESKTOP_SESSION && !readyLogged) { console.info(JSON.stringify({ service: "worker", workerId, status: "ready" })); readyLogged = true; }
      const result = await runWorkerOnce(queue, db, workerId);
      if (!result && !once && !stopping) await waitWithoutTimer(1000);
    } catch (error) {
      if (once) throw error;
      readyLogged = false;
      console.error(JSON.stringify({ service: "worker", workerId, status: "degraded", error: error instanceof Error ? error.message : "Worker tick failed", retrying: true }));
      if (!stopping) await waitWithoutTimer(5000);
    }
  } while (!once && !stopping);

  console.info(JSON.stringify({ service: "worker", workerId, status: "stopped" }));
}

void main().catch((error) => {
  console.error(JSON.stringify({ service: "worker", status: "failed", error: error instanceof Error ? error.message : "Worker failed" }));
  process.exitCode = 1;
});
