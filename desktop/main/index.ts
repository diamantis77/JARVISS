import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, session, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadOwnerConfig } from "../runtime/config";
import { DesktopLogs } from "../runtime/logs";
import { runtimePaths } from "../runtime/paths";
import { RuntimeSupervisor } from "../runtime/supervisor";

type Preferences = { startWithWindows: boolean; bounds?: Electron.Rectangle };
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let statusWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let supervisor: RuntimeSupervisor | null = null;
let logs: DesktopLogs | null = null;
let config: Record<string, string> = {};
let dataDir = "";
let preferencesPath = "";
let preferences: Preferences = { startWithWindows: false };
let quitting = false;
let restarting = false;

const uiOrigin = "http://localhost:3000";
const assets = join(__dirname, "assets");
const preload = join(__dirname, "preload.cjs");
const safeExternal = (raw: string): boolean => {
  try { const url = new URL(raw); return ["https:", "http:"].includes(url.protocol) && url.hostname !== "127.0.0.1" && url.hostname !== "localhost"; } catch { return false; }
};

function restrict(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => { if (safeExternal(url)) void shell.openExternal(url); return { action: "deny" }; });
  window.webContents.on("will-navigate", (event, url) => {
    try {
      const target = new URL(url);
      if (target.protocol === "http:" && target.port === "3000" && ["localhost", "127.0.0.1"].includes(target.hostname)) return;
    } catch { /* block malformed navigation */ }
    event.preventDefault();
    if (safeExternal(url)) void shell.openExternal(url);
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

function windowOptions(): Electron.BrowserWindowConstructorOptions {
  return { icon: join(assets, "jarvis.ico"), show: false, backgroundColor: "#080d16", webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged } };
}

function showSplash(): void {
  splash = new BrowserWindow({ ...windowOptions(), width: 440, height: 220, center: true, resizable: false, frame: false, alwaysOnTop: true });
  restrict(splash);
  void splash.loadFile(join(assets, "splash.html"));
  splash.show();
}

function showMain(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}

function savePreferences(): void {
  if (!preferencesPath) return;
  writeFileSync(preferencesPath, JSON.stringify(preferences), "utf8");
}

function setStartWithWindows(enabled: boolean): void {
  if (!app.isPackaged) throw new Error("Start with Windows is available after installation");
  app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
  const actual = app.getLoginItemSettings().openAtLogin;
  if (actual !== enabled) throw new Error("Windows startup setting could not be confirmed");
  preferences.startWithWindows = actual;
  savePreferences();
  buildTrayMenu();
}

function buildTrayMenu(): void {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open JARVIS", click: showMain },
    { label: "System Status", click: showStatus },
    { label: "Restart Runtime", click: () => { void restartRuntime(); } },
    { type: "separator" },
    { label: "Start with Windows", type: "checkbox", checked: preferences.startWithWindows, click: (item) => { try { setStartWithWindows(item.checked); } catch (error) { dialog.showErrorBox("JARVIS startup setting", error instanceof Error ? error.message : "Unable to change startup setting"); buildTrayMenu(); } } },
    { type: "separator" },
    { label: "Open Logs Folder", click: () => { if (logs) void shell.openPath(logs.directory); } },
    { label: "Exit JARVIS", click: () => { void quitGracefully(); } },
  ]));
}

function showStatus(): void {
  if (statusWindow && !statusWindow.isDestroyed()) { statusWindow.show(); statusWindow.focus(); return; }
  statusWindow = new BrowserWindow({ ...windowOptions(), width: 560, height: 590, minWidth: 480, minHeight: 500, title: "JARVIS System Status" });
  restrict(statusWindow);
  void statusWindow.loadFile(join(assets, "status.html"));
  statusWindow.once("ready-to-show", () => statusWindow?.show());
  statusWindow.on("closed", () => { statusWindow = null; });
}

async function checkRemote(path: string, headers?: Record<string, string>): Promise<Response | null> {
  try { return await fetch(path, { method: "GET", headers, signal: AbortSignal.timeout(5000), redirect: "manual" }); } catch { return null; }
}

async function systemStatus() {
  const services = supervisor?.status() ?? { app: "STOPPED", worker: "STOPPED", scheduler: "STOPPED" };
  const supabaseUrl = config.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = config.SUPABASE_SERVICE_ROLE_KEY;
  const cookies = await session.defaultSession.cookies.get({ url: uiOrigin });
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  let supabase = "OFFLINE";
  let missions = "UNKNOWN";
  if (supabaseUrl && serviceKey) {
    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
    const response = await checkRemote(`${supabaseUrl}/rest/v1/operation_runtime?select=runtime_id&limit=1`, headers);
    if (response?.ok) supabase = "ONLINE";
  }
  if (cookieHeader) {
    const response = await checkRemote(`${uiOrigin}/api/missions`, { Cookie: cookieHeader });
    if (response?.ok) {
      const body = await response.json() as { available?: boolean; missions?: { mission?: { status?: string } }[] };
      if (body.available) missions = body.missions?.some((row) => row.mission?.status === "active") ? "ACTIVE" : "PAUSED";
    }
  }
  let research = "NOT READY";
  if (config.LIVE_RESEARCH_ENABLED === "true" && config.OPENAI_API_KEY) {
    const response = await checkRemote("https://api.openai.com/v1/models?limit=1", { Authorization: `Bearer ${config.OPENAI_API_KEY}` });
    if (response?.ok) research = "READY";
  }
  let phone = "DEGRADED";
  const publicBase = config.PUBLIC_TELEPHONY_BASE_URL;
  if (publicBase?.startsWith("https://")) {
    const publicResponse = await checkRemote(`${publicBase.replace(/\/$/, "")}/auth/sign-in`);
    if (publicResponse && publicResponse.status < 500) {
      if (cookieHeader) {
        const localResponse = await checkRemote(`${uiOrigin}/api/telephony/status`, { Cookie: cookieHeader });
        if (localResponse?.ok) {
          const body = await localResponse.json() as { status?: { readiness?: string } };
          if (body.status?.readiness === "ready") phone = "READY";
        }
      }
    }
  }
  const local = await checkRemote(`${uiOrigin}/auth/sign-in`);
  return { core: services.app === "READY" && local && local.status < 500 ? "ONLINE" : "OFFLINE", worker: services.worker === "READY" ? "ONLINE" : "OFFLINE", scheduler: services.scheduler === "READY" ? "ONLINE" : "OFFLINE", supabase, research, phone, missions, processes: services };
}

async function restartRuntime(): Promise<void> {
  if (!supervisor || restarting || quitting) return;
  restarting = true;
  showSplash();
  try { await supervisor.restart(); splash?.close(); splash = null; mainWindow?.reload(); }
  catch (error) { logs?.write("desktop", `Restart failed: ${error instanceof Error ? error.message : "unknown"}`); dialog.showErrorBox("JARVIS runtime", error instanceof Error ? error.message : "Runtime restart failed"); }
  finally { restarting = false; }
}

async function quitGracefully(): Promise<void> {
  if (quitting) return;
  quitting = true;
  try { await supervisor?.stop(); } catch (error) { logs?.write("desktop", `Shutdown error: ${error instanceof Error ? error.message : "unknown"}`); }
  mainWindow?.destroy(); statusWindow?.destroy(); splash?.destroy(); tray?.destroy();
  app.quit();
}

async function boot(): Promise<void> {
  app.setName("JARVIS");
  Menu.setApplicationMenu(null);
  dataDir = join(app.getPath("appData"), "JARVIS");
  app.setPath("userData", dataDir);
  mkdirSync(dataDir, { recursive: true });
  preferencesPath = join(dataDir, "preferences.json");
  if (existsSync(preferencesPath)) {
    try { preferences = { startWithWindows: false, ...JSON.parse(readFileSync(preferencesPath, "utf8")) }; } catch { /* use safe defaults */ }
  }
  const source = app.isPackaged ? join(app.getPath("home"), "Desktop", "JARVISS", ".env.local") : join(process.cwd(), ".env.local");
  const owner = loadOwnerConfig(dataDir, source);
  config = owner.values;
  logs = new DesktopLogs(dataDir, config);
  logs.write("desktop", `Starting JARVIS Desktop packaged=${app.isPackaged} config=external`);
  const paths = runtimePaths(process.resourcesPath, process.cwd(), app.isPackaged);
  supervisor = new RuntimeSupervisor(paths, dataDir, config, logs);
  ipcMain.handle("jarvis:status", async () => systemStatus());
  tray = new Tray(nativeImage.createFromPath(join(assets, "jarvis.ico")));
  tray.setToolTip("JARVIS");
  tray.on("double-click", showMain);
  buildTrayMenu();
  showSplash();
  try { await supervisor.start(); }
  catch (error) { const message = error instanceof Error ? error.message : "Runtime startup failed"; logs.write("desktop", message); splash?.close(); splash = null; dialog.showErrorBox("JARVIS startup", `${message}\n\nCheck ${logs.directory}`); showStatus(); return; }
  mainWindow = new BrowserWindow({ ...windowOptions(), width: preferences.bounds?.width ?? 1440, height: preferences.bounds?.height ?? 900, x: preferences.bounds?.x, y: preferences.bounds?.y, minWidth: 960, minHeight: 640, title: "JARVIS" });
  restrict(mainWindow);
  mainWindow.on("close", (event) => { if (!quitting) { event.preventDefault(); mainWindow?.hide(); } });
  mainWindow.on("minimize", () => { mainWindow?.hide(); });
  mainWindow.on("resize", () => { if (mainWindow && !mainWindow.isMaximized()) { preferences.bounds = mainWindow.getBounds(); savePreferences(); } });
  mainWindow.on("move", () => { if (mainWindow && !mainWindow.isMaximized()) { preferences.bounds = mainWindow.getBounds(); savePreferences(); } });
  mainWindow.on("session-end", () => { void quitGracefully(); });
  await mainWindow.loadURL(uiOrigin);
  splash?.close(); splash = null;
  if (!process.argv.includes("--hidden")) mainWindow.show();
}

if (gotLock) {
  app.on("second-instance", () => showMain());
  app.on("window-all-closed", () => { /* tray retains the owner session */ });
  app.on("before-quit", (event) => { if (!quitting) { event.preventDefault(); void quitGracefully(); } });
  void app.whenReady().then(boot).catch((error) => { dialog.showErrorBox("JARVIS Desktop", error instanceof Error ? error.message : "Desktop failed"); app.quit(); });
}
