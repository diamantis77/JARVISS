import { contextBridge, ipcRenderer } from "electron";

// Exactly one read-only IPC capability. No configuration, filesystem, process,
// shell, or arbitrary channel access is exposed to the web application.
contextBridge.exposeInMainWorld("jarvisDesktop", Object.freeze({
  status: () => ipcRenderer.invoke("jarvis:status"),
}));
