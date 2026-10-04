import { existsSync, mkdirSync, readFileSync, copyFileSync, chmodSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "dotenv";

export const CONFIG_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY", "TELEPHONY_PROVIDER", "VONAGE_APPLICATION_ID",
  "VONAGE_PRIVATE_KEY", "VONAGE_API_KEY", "VONAGE_API_SECRET", "VONAGE_API_SIGNATURE_SECRET",
  "VONAGE_PHONE_NUMBER", "JARVIS_OWNER_PHONE_NUMBER", "PUBLIC_TELEPHONY_BASE_URL",
] as const;

export function inspectEnv(source: string): Record<string, string> {
  const values = parse(source);
  const occurrences = new Map<string, string[]>();
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match) continue;
    const key = match[1];
    occurrences.set(key, [...(occurrences.get(key) ?? []), values[key] ?? ""]);
  }
  // Fail closed on duplicates. dotenv's last-wins behavior must never silently
  // replace an owner credential with a stale or empty value.
  for (const [key, entries] of occurrences) {
    if (entries.length > 1) throw new Error(`Duplicate configuration entry: ${key}`);
  }
  return values;
}

export function loadOwnerConfig(dataDir: string, ownerSource: string): { path: string; values: Record<string, string> } {
  const configDir = join(dataDir, "config");
  mkdirSync(configDir, { recursive: true });
  const target = join(configDir, ".env.local");
  const firstRun = !existsSync(target);
  if (firstRun) {
    if (!existsSync(ownerSource)) throw new Error(`Owner configuration missing. Put .env.local in ${configDir}`);
    // First-run migration. The source remains untouched and the copy is never bundled.
    copyFileSync(ownerSource, target);
    try { chmodSync(target, 0o600); } catch { /* Windows ACLs are inherited from the user profile. */ }
  }
  const values = inspectEnv(readFileSync(target, "utf8"));
  // Vonage accepts a PEM or a file path. Keep file-backed keys in the owner's
  // private app-data directory, never in an extractable installer resource.
  const key = values.VONAGE_PRIVATE_KEY;
  if (key && !key.includes("BEGIN PRIVATE KEY")) {
    const sourcePath = isAbsolute(key) ? key : resolve(firstRun ? dirname(ownerSource) : configDir, key);
    if (!existsSync(sourcePath)) throw new Error("Configured Vonage private key file is missing");
    const privateTarget = join(configDir, "vonage-private.key");
    if (sourcePath !== privateTarget) copyFileSync(sourcePath, privateTarget);
    try { chmodSync(privateTarget, 0o600); } catch { /* inherited Windows user ACL */ }
    values.VONAGE_PRIVATE_KEY = privateTarget;
  }
  if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Required Supabase desktop configuration is missing");
  }
  return { path: target, values };
}
