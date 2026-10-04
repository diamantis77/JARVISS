import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const root = resolve(import.meta.dirname, "..");
const stage = join(root, ".desktop-build");
const server = join(stage, "jarvis-server");
const dist = join(root, "desktop", "dist");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

if (!process.argv.includes("--reuse-web-build")) {
  const webBuild = spawnSync(npm, ["run", "build"], { cwd: root, stdio: "inherit", env: { ...process.env, JARVIS_DESKTOP_BUILD: "1" }, shell: process.platform === "win32" });
  if (webBuild.status !== 0) throw new Error("Desktop web build failed");
}
if (!existsSync(join(root, ".next", "standalone", "server.js"))) throw new Error("Next standalone output is missing");

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(server, "scripts"), { recursive: true });
cpSync(join(root, ".next", "standalone"), server, { recursive: true, filter: (source) => !/[/\\]\.env(?:\.|$)/i.test(source) });
// electron-builder excludes directories named node_modules from extraResources.
// Keep the standalone traced dependencies outside the app bundle under a
// neutral directory and give only owned child processes its lookup path.
if (!existsSync(join(server, "node_modules", "next"))) throw new Error("Next standalone dependencies are missing");
renameSync(join(server, "node_modules"), join(server, "vendor"));
// Next's standalone trace covers server.js, not the custom telephony server.
// The latter calls next() directly and requires the complete Next package.
cpSync(join(root, "node_modules", "next"), join(server, "vendor", "next"), { recursive: true });
const swc = join(root, "node_modules", "@next", "swc-win32-x64-msvc");
if (process.platform === "win32" && existsSync(swc)) {
  mkdirSync(join(server, "vendor", "@next"), { recursive: true });
  cpSync(swc, join(server, "vendor", "@next", "swc-win32-x64-msvc"), { recursive: true });
}
mkdirSync(join(server, ".next"), { recursive: true });
cpSync(join(root, ".next", "static"), join(server, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) cpSync(join(root, "public"), join(server, "public"), { recursive: true });

for (const [name, entry] of Object.entries({ app: "next-with-telephony", worker: "worker", scheduler: "scheduler" })) {
  await build({ entryPoints: [join(root, "scripts", `${entry}.ts`)], outfile: join(server, "scripts", `${name}.cjs`), bundle: true, platform: "node", format: "cjs", target: "node22", packages: "bundle", external: ["next", "next/*", "sharp", "@next/swc-*"], tsconfig: join(root, "tsconfig.json"), logLevel: "warning" });
}

mkdirSync(dist, { recursive: true });
await build({ entryPoints: [join(root, "desktop", "main", "index.ts")], outfile: join(dist, "main.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "warning" });
await build({ entryPoints: [join(root, "desktop", "preload", "index.ts")], outfile: join(dist, "preload.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "warning" });
cpSync(join(root, "desktop", "assets"), join(dist, "assets"), { recursive: true });
const svg = readFileSync(join(root, "desktop", "assets", "jarvis.svg"));
const png = await sharp(svg).resize(256, 256).png().toBuffer();
writeFileSync(join(dist, "assets", "jarvis.ico"), await pngToIco(png));
console.log("JARVIS Desktop staged without secrets in .desktop-build and desktop/dist");
const audit = spawnSync(process.execPath, [join(root, "scripts", "audit-desktop-secrets.mjs")], { cwd: root, stdio: "inherit" });
if (audit.status !== 0) throw new Error("Desktop secret audit failed");
