import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { handleTwilioMediaSocket } from "../lib/telephony/media-bridge";
import { validateTwilioUpgrade } from "../lib/telephony/security";
import { validateVonageMediaAuthorization } from "../lib/telephony/vonage-auth";
import { handleVonageMediaSocket } from "../lib/telephony/vonage-media-bridge";

async function main() {
  const dev = process.env.NODE_ENV !== "production";
  const hostname = process.env.HOSTNAME ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? 3000);
  const app = next({ dev, hostname, port });
  await app.prepare();
  const handler = app.getRequestHandler();
  const upgradeHandler = app.getUpgradeHandler();
  const mediaServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const server = createServer((request, response) => {
    if (process.env.JARVIS_DESKTOP_SESSION) response.setHeader("X-JARVIS-Desktop-Session", process.env.JARVIS_DESKTOP_SESSION);
    return handler(request, response);
  });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/api/telephony/vonage/media") {
      const authorization = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization;
      const claims = validateVonageMediaAuthorization(authorization);
      // Let the full rejection response flush before closing the TCP socket.
      // Destroying it immediately can make an upstream proxy surface a 5xx.
      if (!claims) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); return; }
      mediaServer.handleUpgrade(request, socket, head, (webSocket) => handleVonageMediaSocket(webSocket, claims)); return;
    }
    if (url.pathname !== "/api/telephony/twilio/media") { upgradeHandler(request, socket, head); return; }
    const signature = Array.isArray(request.headers["x-twilio-signature"]) ? request.headers["x-twilio-signature"][0] : request.headers["x-twilio-signature"];
    if (!validateTwilioUpgrade(signature, `${url.pathname}${url.search}`)) { socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
    mediaServer.handleUpgrade(request, socket, head, (webSocket) => handleTwilioMediaSocket(webSocket));
  });
  server.listen(port, hostname, () => console.log(`[jarvis] ready on http://127.0.0.1:${port} · telephony gateway attached`));
  function shutdown() { mediaServer.close(); server.close(() => process.exit(0)); }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  if (process.env.JARVIS_DESKTOP_SESSION) {
    process.on("message", (message) => { if (message === "jarvis-desktop-shutdown") shutdown(); });
    process.once("disconnect", shutdown);
  }
}

void main().catch((error) => { console.error(`[jarvis] server failed: ${error instanceof Error ? error.message : "unknown error"}`); process.exitCode = 1; });
