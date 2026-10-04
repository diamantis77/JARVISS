import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 4 * 1024 * 1024;
const names = new Set(["desktop", "runtime", "worker", "scheduler"]);

export class DesktopLogs {
  readonly directory: string;
  private readonly secrets: string[];
  constructor(dataDir: string, env: Record<string, string>) {
    this.directory = join(dataDir, "logs");
    mkdirSync(this.directory, { recursive: true });
    this.secrets = Object.entries(env).filter(([key, value]) => /KEY|TOKEN|SECRET|PASSWORD|PRIVATE/i.test(key) && value.length >= 6).map(([, value]) => value);
  }
  write(name: string, raw: string): void {
    if (!names.has(name)) return;
    const path = join(this.directory, `${name}.log`);
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      const backup = `${path}.1`;
      if (existsSync(backup)) rmSync(backup);
      renameSync(path, backup);
    }
    let safe = raw.slice(0, 16_000);
    for (const secret of this.secrets) safe = safe.split(secret).join("[redacted]");
    safe = safe.replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[redacted]");
    appendFileSync(path, `${new Date().toISOString()} ${safe.replace(/[\r\n]+/g, " ")}\n`, "utf8");
  }
}
