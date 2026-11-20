import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type CodeMindDesktopAPI, type SetThemeRequest } from "@codemind/shared";

/**
 * Restricted preload bridge.
 * Only explicitly approved Phase 1 methods are exposed to the renderer.
 * No Node.js APIs, raw ipcRenderer, filesystem, or shell operations are exposed.
 */
const desktopApi: CodeMindDesktopAPI = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),
  getPlatformInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PLATFORM),
  healthCheck: () => ipcRenderer.invoke(IPC_CHANNELS.APP_HEALTH_CHECK),
  getTheme: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET),
  setTheme: (request: SetThemeRequest) => ipcRenderer.invoke(IPC_CHANNELS.THEME_SET, request)
});

contextBridge.exposeInMainWorld("codemindDesktop", desktopApi);
