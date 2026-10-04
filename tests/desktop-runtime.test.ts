import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { inspectEnv, loadOwnerConfig } from "../desktop/runtime/config";
import { DesktopLogs } from "../desktop/runtime/logs";
import { runtimePaths } from "../desktop/runtime/paths";
import { RuntimeSupervisor } from "../desktop/runtime/supervisor";

const temporary: string[] = [];
function temp() { const dir = mkdtempSync(join(tmpdir(), "jarvis-desktop-test-")); temporary.push(dir); return dir; }
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("owner desktop boundaries", () => {
  it("rejects duplicate environment entries instead of silently overriding credentials", () => {
    expect(() => inspectEnv("OPENAI_API_KEY=first\nOPENAI_API_KEY=\n")).toThrow(/Duplicate configuration entry/);
  });

  it("migrates configuration outside the package and leaves the source unchanged", () => {
    const dir = temp();
    const source = join(dir, ".env.local");
    const input = "NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=private-test-value\n";
    writeFileSync(source, input);
    const result = loadOwnerConfig(join(dir, "appdata"), source);
    expect(result.path).toBe(join(dir, "appdata", "config", ".env.local"));
    expect(readFileSync(result.path, "utf8")).toBe(input);
    expect(readFileSync(source, "utf8")).toBe(input);
  });

  it("resolves packaged scripts only under the resources directory", () => {
    const paths = runtimePaths("C:\\Program Files\\JARVIS\\resources", "C:\\source", true);
    expect(paths.worker).toContain("jarvis-server");
    expect(paths.worker).toContain("worker.cjs");
  });

  it("redacts credential values from local logs", () => {
    const dir = temp();
    const logs = new DesktopLogs(dir, { OPENAI_API_KEY: "private-test-value" });
    logs.write("desktop", "warning private-test-value");
    expect(readFileSync(join(logs.directory, "desktop.log"), "utf8")).not.toContain("private-test-value");
  });

  it("starts exactly one of each owned child, stops them, and ignores stale PIDs", async () => {
    const dir = temp();
    const server = join(dir, "server");
    const scripts = join(server, "scripts");
    mkdirSync(scripts, { recursive: true });
    const appScript = `const http=require('node:http');const server=http.createServer((q,r)=>{r.setHeader('X-JARVIS-Desktop-Session',process.env.JARVIS_DESKTOP_SESSION);r.end('ok')});server.listen(Number(process.env.PORT),'127.0.0.1');function stop(){server.close(()=>process.exit(0))}process.on('message',m=>{if(m==='jarvis-desktop-shutdown')stop()});process.on('disconnect',stop);`;
    const readyScript = (state: string) => `console.log(JSON.stringify({status:'${state}'}));process.on('message',m=>{if(m==='jarvis-desktop-shutdown')process.exit(0)});process.on('disconnect',()=>process.exit(0));setInterval(()=>{},1000);`;
    writeFileSync(join(scripts, "app.cjs"), appScript);
    writeFileSync(join(scripts, "worker.cjs"), readyScript("ready"));
    writeFileSync(join(scripts, "scheduler.cjs"), readyScript("tick"));
    const listener = createServer();
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const port = (listener.address() as { port: number }).port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const data = join(dir, "data");
    mkdirSync(join(data, "runtime"), { recursive: true });
    writeFileSync(join(data, "runtime", "session.json"), JSON.stringify({ parentPid: 999999 }));
    const logs = new DesktopLogs(data, {});
    const supervisor = new RuntimeSupervisor({ server, app: join(scripts, "app.cjs"), worker: join(scripts, "worker.cjs"), scheduler: join(scripts, "scheduler.cjs") }, data, {}, logs, process.execPath, port);
    expect(supervisor.staleSessionFound).toBe(true);
    try {
      await supervisor.start();
      expect(supervisor.status().app).toBe("READY");
      expect(Object.keys(supervisor.pids())).toHaveLength(3);
      await expect(supervisor.start()).rejects.toThrow(/already/);
    } finally { await supervisor.stop(); }
    expect(supervisor.status()).toEqual({ app: "STOPPED", worker: "STOPPED", scheduler: "STOPPED" });
  }, 15_000);
});
