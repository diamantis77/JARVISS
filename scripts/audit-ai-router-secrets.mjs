import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const envPath = join(root, ".env.local");
const env = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const names = ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY"];
const values = names.map((name) => env[name]).filter((value) => typeof value === "string" && value.length >= 12).map((value) => Buffer.from(value));
let checked = 0;
let leaks = 0;
for (const directory of [join(root, ".next", "static"), join(root, ".next-dev", "static")]) {
  if (!existsSync(directory)) continue;
  const pending = [directory];
  while (pending.length) {
    const folder = pending.pop();
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { pending.push(path); continue; }
      if (!entry.isFile()) continue;
      checked++;
      const content = readFileSync(path);
      if (values.some((value) => content.includes(value))) leaks++;
    }
  }
}
console.log(JSON.stringify({ clientFilesChecked: checked, configuredKeysChecked: values.length, clientBundleSecretLeaks: leaks }));
if (leaks) process.exitCode = 1;
