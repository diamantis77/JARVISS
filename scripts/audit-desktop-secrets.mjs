import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const source = join(root, ".env.local");
const env = parse(readFileSync(source));
const keys = ["SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "VONAGE_API_SECRET", "VONAGE_API_SIGNATURE_SECRET", "VONAGE_PRIVATE_KEY", "TWILIO_AUTH_TOKEN", "GOOGLE_CLIENT_SECRET"];
const protectedValues = keys.map((key) => env[key]).filter((value) => value && value.length >= 8).map((value) => Buffer.from(value));
let files = 0;
let leaks = 0;
function walk(folder) {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, item.name);
    if (item.isDirectory()) { walk(path); continue; }
    if (!item.isFile()) continue;
    files++;
    if (/^\.env(?:\.|$)/i.test(item.name) || /\.(pem|key|p12|pfx)$/i.test(item.name)) { leaks++; continue; }
    // Skip giant native binaries; secrets can only enter generated JS/JSON/text
    // through bundling, not through a vendor executable copied byte-for-byte.
    if (statSync(path).size > 80 * 1024 * 1024) continue;
    const content = readFileSync(path);
    if (protectedValues.some((value) => content.includes(value))) leaks++;
  }
}
walk(join(root, ".desktop-build", "jarvis-server"));
walk(join(root, "desktop", "dist"));
console.log(`Desktop secret audit: ${files} staged files checked; ${leaks} potential leaks`);
if (leaks) process.exitCode = 1;
