import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import WebSocket from "ws";
import { createVonageMediaAuthorization } from "../lib/telephony/vonage-auth.ts";

nextEnv.loadEnvConfig(process.cwd());

const base = process.argv[2]?.replace(/\/+$/, "");
if (!base || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(base)) {
  throw new Error("Expected a Cloudflare Quick Tunnel HTTPS base URL");
}

const results = { https: { passed: 0, total: 20 }, validWss: { passed: 0, total: 20 }, invalidWss: { passed: 0, total: 20 }, unexpected5xx: 0, failures: [] };
const record = (phase, attempt, check, actual, expected) => {
  if (actual === expected) return true;
  if (typeof actual === "number" && actual >= 500) results.unexpected5xx += 1;
  results.failures.push({ phase, attempt, check, actual, expected });
  return false;
};
const stopFailedCandidate = () => {
  if (results.failures.length === 0) return;
  console.log(JSON.stringify({ passed: false, ...results }));
  process.exit(2);
};

async function httpStatus(path, method = "GET") {
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? "{}" : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
    await response.body?.cancel();
    return response.status;
  } catch (error) {
    return error instanceof Error ? error.name : "request_error";
  }
}

function webSocketStatus(authorization) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const socket = new WebSocket(`${base.replace(/^https:/, "wss:")}/api/telephony/vonage/media`, {
      headers: { authorization }, handshakeTimeout: 8_000, perMessageDeflate: false,
    });
    const timer = setTimeout(() => { socket.terminate(); finish("timeout"); }, 10_000);
    socket.on("open", () => { socket.close(1000, "preflight"); finish(101); });
    socket.on("unexpected-response", (request, response) => {
      const status = response.statusCode ?? "missing_status";
      finish(status);
      response.resume();
      request.destroy();
    });
    socket.on("error", (error) => {
      const serverStatus = error instanceof Error ? error.message.match(/^Unexpected server response: (\d{3})$/)?.[1] : null;
      finish(serverStatus ? Number(serverStatus) : (error && typeof error === "object" && "code" in error ? String(error.code) : "socket_error"));
    });
  });
}

for (let attempt = 1; attempt <= 20; attempt += 1) {
  const home = await httpStatus("/auth/sign-in");
  const answer = await httpStatus("/api/telephony/vonage/answer", "POST");
  const event = await httpStatus("/api/telephony/vonage/event", "POST");
  if ([record("https", attempt, "sign_in", home, 200), record("https", attempt, "answer_unsigned", answer, 403), record("https", attempt, "event_unsigned", event, 403)].every(Boolean)) results.https.passed += 1;
  if (attempt % 5 === 0) console.log(JSON.stringify({ phase: "https", completed: attempt, at: new Date().toISOString() }));
  stopFailedCandidate();
}

for (let attempt = 1; attempt <= 20; attempt += 1) {
  // A call-bound token with a random, nonexistent call ID tests only the
  // authenticated upgrade. No provider call or durable phone job is created.
  const token = createVonageMediaAuthorization(randomUUID(), undefined, 60);
  const status = await webSocketStatus(`Bearer ${token}`);
  if (record("valid_wss", attempt, "upgrade", status, 101)) results.validWss.passed += 1;
  if (attempt % 5 === 0) console.log(JSON.stringify({ phase: "valid_wss", completed: attempt, at: new Date().toISOString() }));
  stopFailedCandidate();
}

for (let attempt = 1; attempt <= 20; attempt += 1) {
  const status = await webSocketStatus("Bearer invalid");
  if (record("invalid_wss", attempt, "rejection", status, 403)) results.invalidWss.passed += 1;
  if (attempt % 5 === 0) console.log(JSON.stringify({ phase: "invalid_wss", completed: attempt, at: new Date().toISOString() }));
  stopFailedCandidate();
}

const passed = results.https.passed === 20 && results.validWss.passed === 20 && results.invalidWss.passed === 20 && results.unexpected5xx === 0;
console.log(JSON.stringify({ passed, ...results }));
if (!passed) process.exitCode = 2;
