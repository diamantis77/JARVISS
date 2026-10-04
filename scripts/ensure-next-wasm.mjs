import { cp, mkdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

// Next 15.5.25 loads its WASM fallback from next/wasm after a native load
// failure. Keep that fallback local to this project's dependencies; never
// change Windows Application Control policy or an unrelated installation.
if (process.platform === "win32") {
  const modules = resolve("node_modules");
  const nextDir = join(modules, "next");
  const source = join(modules, "@next", "swc-wasm-nodejs");
  const target = join(nextDir, "wasm", "@next", "swc-wasm-nodejs");
  if (!target.startsWith(nextDir + sep)) throw new Error("Unexpected WASM fallback destination");
  const next = JSON.parse(await readFile(join(nextDir, "package.json"), "utf8"));
  const wasm = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  if (next.version !== wasm.version) throw new Error("Next.js and SWC WASM versions do not match");
  await mkdir(target, { recursive: true });
  for (const file of ["package.json", "wasm.js", "wasm_bg.wasm", "wasm.d.ts"]) {
    await cp(join(source, file), join(target, file), { force: true });
  }
  process.stdout.write(`JARVIS Next.js ${next.version}: matching local SWC WASM fallback ready.\n`);
}
