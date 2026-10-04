import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { DesktopLogs } from "./logs";
import type { runtimePaths } from "./paths";

export type Service = "app" | "worker" | "scheduler";
export type ServiceState = "STOPPED" | "STARTING" | "READY" | "DEGRADED" | "FAILED";
type Paths = ReturnType<typeof runtimePaths>;

export class RuntimeSupervisor {
  private readonly children = new Map<Service, ChildProcess>();
  private readonly states: Record<Service, ServiceState> = { app: "STOPPED", worker: "STOPPED", scheduler: "STOPPED" };
  private readonly session = randomUUID();
  private readonly metadataPath: string;
  private shuttingDown = false;
  private startInProgress = false;
  readonly staleSessionFound: boolean;

  constructor(private readonly paths: Paths, private readonly dataDir: string, private readonly values: Record<string, string>, private readonly logs: DesktopLogs, private readonly executable = process.execPath, private readonly port = 3000) {
    mkdirSync(join(dataDir, "runtime"), { recursive: true });
    this.metadataPath = join(dataDir, "runtime", "session.json");
    this.staleSessionFound = existsSync(this.metadataPath);
    // Metadata is informational only. Never kill a PID from a prior session:
    // Windows may have recycled it for an unrelated process.
    if (this.staleSessionFound) {
      try { JSON.parse(readFileSync(this.metadataPath, "utf8")); } catch { /* stale/corrupt metadata is safe to replace */ }
      this.logs.write("desktop", "Previous session metadata found; new session will not signal stale PIDs");
    }
  }

  status(): Record<Service, ServiceState> { return { ...this.states }; }
  pids(): Partial<Record<Service, number>> { return Object.fromEntries([...this.children].map(([name, child]) => [name, child.pid])); }

  private writeMetadata(): void {
    writeFileSync(this.metadataPath, JSON.stringify({ session: this.session, parentPid: process.pid, children: this.pids(), startedAt: new Date().toISOString() }));
  }

  private launch(name: Service, script: string): void {
    if (this.children.has(name)) throw new Error(`${name} already owned by this desktop session`);
    this.states[name] = "STARTING";
    const env: NodeJS.ProcessEnv = {
      ...process.env, ...this.values,
      NODE_ENV: "production", PORT: String(this.port), HOSTNAME: "127.0.0.1",
      JARVIS_DESKTOP_SESSION: this.session,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_PATH: join(this.paths.server, "vendor"),
    };
    const child: ChildProcess = spawn(this.executable, [script], { cwd: this.paths.server, env, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    this.children.set(name, child);
    this.writeMetadata();
    const logName = name === "app" ? "runtime" : name;
    const ingest = (chunk: Buffer) => {
      const message = chunk.toString("utf8");
      this.logs.write(logName, message);
      if (name === "worker" && message.includes('"status":"ready"')) this.states.worker = "READY";
      if (name === "scheduler" && message.includes('"status":"tick"')) this.states.scheduler = "READY";
      if (message.includes('"status":"degraded"')) this.states[name] = "DEGRADED";
    };
    child.stdout?.on("data", ingest);
    child.stderr?.on("data", ingest);
    child.once("error", (error) => { this.states[name] = "FAILED"; this.logs.write(logName, `Process error: ${error.message}`); });
    child.once("exit", (code, signal) => {
      this.children.delete(name);
      this.states[name] = this.shuttingDown ? "STOPPED" : "FAILED";
      this.logs.write(logName, `Process exited code=${code ?? "none"} signal=${signal ?? "none"}`);
      this.writeMetadata();
    });
  }

  private async waitForApp(): Promise<void> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (!this.children.has("app")) throw new Error("JARVIS app exited during startup");
      try {
        const response = await fetch(`http://127.0.0.1:${this.port}/auth/sign-in`, { signal: AbortSignal.timeout(2500), redirect: "manual" });
        if (response.headers.get("x-jarvis-desktop-session") === this.session && response.status < 500) {
          this.states.app = "READY";
          return;
        }
      } catch { /* still starting */ }
      await delay(500);
    }
    throw new Error("JARVIS app health check timed out or port 3000 belongs to another process");
  }

  async start(): Promise<void> {
    if (this.startInProgress || this.children.size) throw new Error("Desktop runtime already starting or running");
    this.startInProgress = true;
    this.shuttingDown = false;
    try {
      for (const script of [this.paths.app, this.paths.worker, this.paths.scheduler]) if (!existsSync(script)) throw new Error(`Packaged runtime missing: ${script}`);
      this.launch("app", this.paths.app);
      await this.waitForApp();
      this.launch("worker", this.paths.worker);
      this.launch("scheduler", this.paths.scheduler);
      this.logs.write("desktop", "Desktop runtime started; app health verified before background services");
    } catch (error) {
      await this.stop();
      throw error;
    } finally { this.startInProgress = false; }
  }

  private async stopChild(name: Service): Promise<void> {
    const child = this.children.get(name);
    if (!child) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try { child.send("jarvis-desktop-shutdown"); } catch { /* already exiting */ }
    // A claimed durable job must finish before the worker exits. A five-minute
    // grace window avoids interrupting ordinary research runs during Exit.
    await Promise.race([exited, delay(name === "worker" ? 300_000 : 8_000)]);
    if (this.children.get(name) === child) {
      this.logs.write("desktop", `${name} exceeded graceful shutdown deadline; terminating owned child`);
      child.kill();
      await Promise.race([exited, delay(3_000)]);
    }
  }

  async stop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    for (const name of ["scheduler", "worker", "app"] as const) await this.stopChild(name);
    for (const name of ["scheduler", "worker", "app"] as const) if (!this.children.has(name)) this.states[name] = "STOPPED";
    try { rmSync(this.metadataPath); } catch { /* may already have been removed */ }
    this.logs.write("desktop", "Owned runtime stopped");
  }

  async restart(): Promise<void> { await this.stop(); await this.start(); }
}
