import { commandSchema } from "@/lib/validation";
import { demoRun } from "@/lib/demo-data";
import { log } from "@/lib/logger";
import type { JarvisRun } from "@/types";

export function createDemoRun(rawRequest: string): JarvisRun {
  const { command } = commandSchema.parse({ command: rawRequest });
  const run = { ...demoRun, id: `run_${crypto.randomUUID()}`, request: command, createdAt: "Just now" };
  log("run_started", { runId: run.id });
  return run;
}
