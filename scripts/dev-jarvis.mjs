import { spawn } from "node:child_process";
import { resolve } from "node:path";

const node = process.execPath;
const services = [
  ["app", resolve("node_modules/tsx/dist/cli.mjs"), ["scripts/next-with-telephony.ts"]],
  ["worker", resolve("node_modules/tsx/dist/cli.mjs"), ["scripts/worker.ts"]],
  ["scheduler", resolve("node_modules/tsx/dist/cli.mjs"), ["scripts/scheduler.ts"]],
];

const children = new Map();
let stopping = false;

for (const [name, entrypoint, args] of services) {
  const child = spawn(node, [entrypoint, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
    windowsHide: true,
  });
  children.set(name, child);
  child.once("error", (error) => {
    console.error(`[dev:jarvis] ${name} failed to start: ${error.message}`);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    children.delete(name);
    if (!stopping) {
      console.error(`[dev:jarvis] ${name} stopped unexpectedly (${signal ?? code ?? "unknown"}).`);
      shutdown(code || 1);
    }
  });
}

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) {
    if (!child.killed) child.kill("SIGTERM");
  }
  const forceExit = setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 3_000);
  forceExit.unref();
  if (children.size === 0) process.exit(exitCode);
  for (const child of children.values()) {
    child.once("exit", () => {
      if (children.size === 0) process.exit(exitCode);
    });
  }
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
