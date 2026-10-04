import { join } from "node:path";

export function runtimePaths(resourcesPath: string, repositoryRoot: string, packaged: boolean) {
  const server = packaged ? join(resourcesPath, "jarvis-server") : join(repositoryRoot, ".desktop-build", "jarvis-server");
  return {
    server,
    app: join(server, "scripts", "app.cjs"),
    worker: join(server, "scripts", "worker.cjs"),
    scheduler: join(server, "scripts", "scheduler.cjs"),
  };
}
