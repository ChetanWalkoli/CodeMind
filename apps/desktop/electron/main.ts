import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { APP_CONSTANTS } from "@codemind/config";
import { registerIpcHandlers, unregisterIpcHandlers } from "./ipc/index.js";
import { PreferencesStore } from "./utils/preferences.js";
import { createMainWindow } from "./window.js";
import { WorkspaceFileService } from "./workspace/filesystem.js";
import { WorkspaceAuthority } from "./workspace/pathSecurity.js";

const disableGpu = process.env.CODEMIND_DISABLE_GPU === "1";
if (disableGpu) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  console.info("[CodeMind] GPU hardware acceleration: disabled (CODEMIND_DISABLE_GPU=1)");
} else {
  console.info("[CodeMind] GPU hardware acceleration: enabled (default)");
}

let mainWindow: BrowserWindow | null = null;
let preferencesStore: PreferencesStore | null = null;
const workspaceAuthority = new WorkspaceAuthority();
const workspaceFileService = new WorkspaceFileService(workspaceAuthority);

function getPreferencesStore(): PreferencesStore {
  if (!preferencesStore) {
    preferencesStore = new PreferencesStore(app.getPath("userData"));
  }
  return preferencesStore;
}

function getPreloadPath(): string {
  return path.join(__dirname, "preload.cjs");
}

function getRendererDistPath(): string {
  return path.resolve(__dirname, "../dist");
}

async function selectWorkspaceFolderDialog(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Open Project Folder",
    properties: ["openDirectory"]
  };

  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

function createWindow(): void {
  const preferences = getPreferencesStore();
  const theme = preferences.getTheme();
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  mainWindow = createMainWindow({
    preloadPath: getPreloadPath(),
    rendererDistPath: getRendererDistPath(),
    devServerUrl,
    theme
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

process.on("uncaughtException", (error) => {
  console.error("[CodeMind] Uncaught main-process exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[CodeMind] Unhandled main-process rejection:", reason);
});

app
  .whenReady()
  .then(() => {
    const preferences = getPreferencesStore();

    registerIpcHandlers(ipcMain, {
      metadata: {
        name: APP_CONSTANTS.APP_NAME,
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        electronVersion: process.versions.electron ?? "unknown",
        nodeVersion: process.versions.node ?? "unknown",
        chromeVersion: process.versions.chrome ?? "unknown"
      },
      preferences,
      authority: workspaceAuthority,
      fileService: workspaceFileService,
      selectFolder: selectWorkspaceFolderDialog
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    console.error("[CodeMind] Failed to initialize Electron application:", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  unregisterIpcHandlers(ipcMain);
});
