import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import path from "node:path";
import { APP_CONSTANTS } from "@codemind/config";
import { ConversationStore } from "./ai/conversationStore.js";
import { CredentialStore } from "./ai/credentialStore.js";
import { AIProviderManager } from "./ai/providerManager.js";
import { AIUsageStore } from "./ai/usageStore.js";
import { DecisionStore } from "./decisions/decisionStore.js";
import { ImpactStore } from "./impact/impactStore.js";
import { IntentStore } from "./intent/intentStore.js";
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
let credentialStore: CredentialStore | null = null;
let aiProviderManager: AIProviderManager | null = null;
let conversationStore: ConversationStore | null = null;
let usageStore: AIUsageStore | null = null;
let intentStore: IntentStore | null = null;
let decisionStore: DecisionStore | null = null;
const workspaceAuthority = new WorkspaceAuthority();
const workspaceFileService = new WorkspaceFileService(workspaceAuthority);

function getPreferencesStore(): PreferencesStore {
  if (!preferencesStore) {
    preferencesStore = new PreferencesStore(app.getPath("userData"));
  }
  return preferencesStore;
}

function getCredentialStore(): CredentialStore {
  if (!credentialStore) {
    credentialStore = new CredentialStore(app.getPath("userData"), safeStorage);
  }
  return credentialStore;
}

function getAIProviderManager(): AIProviderManager {
  if (!aiProviderManager) {
    aiProviderManager = new AIProviderManager(getCredentialStore());
  }
  return aiProviderManager;
}

function getConversationStore(): ConversationStore {
  if (!conversationStore) {
    conversationStore = new ConversationStore(app.getPath("userData"));
  }
  return conversationStore;
}

function getUsageStore(): AIUsageStore {
  if (!usageStore) {
    usageStore = new AIUsageStore(app.getPath("userData"));
  }
  return usageStore;
}

function getIntentStore(): IntentStore {
  if (!intentStore) {
    intentStore = new IntentStore(app.getPath("userData"));
  }
  return intentStore;
}

function getDecisionStore(): DecisionStore {
  if (!decisionStore) {
    decisionStore = new DecisionStore(app.getPath("userData"));
  }
  return decisionStore;
}

let impactStore: ImpactStore | null = null;

function getImpactStore(): ImpactStore {
  if (!impactStore) {
    impactStore = new ImpactStore(app.getPath("userData"));
  }
  return impactStore;
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
    const credentials = getCredentialStore();
    const providerManager = getAIProviderManager();
    const conversations = getConversationStore();
    const usage = getUsageStore();

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
      selectFolder: selectWorkspaceFolderDialog,
      credentials,
      providerManager,
      conversationStore: conversations,
      usageStore: usage,
      intentStore: getIntentStore(),
      decisionStore: getDecisionStore(),
      impactStore: getImpactStore()
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
