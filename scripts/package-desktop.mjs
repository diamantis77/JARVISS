import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const payload = join(root, "dist-desktop", "win-unpacked");
const installer = join(root, "dist-desktop", "JARVIS-Setup.exe");
const icon = join(root, "desktop", "dist", "assets", "jarvis.ico");
if (!existsSync(join(payload, "JARVIS.exe")) || !existsSync(join(payload, "resources", "jarvis-server", "vendor", "next"))) {
  throw new Error("Packaged JARVIS payload is incomplete");
}

function findMakensis(directory) {
  if (!existsSync(directory)) return null;
  const direct = join(directory, "makensis.exe");
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findMakensis(join(directory, entry.name));
    if (found) return found;
  }
  return null;
}

const makensis = process.env.JARVIS_NSIS_PATH || findMakensis(join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache", "nsis-3.0.4.1"));
if (!makensis || !existsSync(makensis)) throw new Error("NSIS compiler not found. Install NSIS or set JARVIS_NSIS_PATH.");
const result = spawnSync(makensis, [`/DINSTALLER_OUT=${installer}`, `/DAPP_PAYLOAD=${payload}`, `/DAPP_ICON=${icon}`, join(root, "desktop", "installer.nsi")], { cwd: root, stdio: "inherit", windowsHide: true });
if (result.status !== 0 || !existsSync(installer) || statSync(installer).size < 1_000_000) throw new Error("JARVIS NSIS installer build failed");
console.log(`Installer ready: ${installer}`);
