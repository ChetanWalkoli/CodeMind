import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type CodeMindDesktopAPI,
  type EngineFileIntelRequest,
  type EngineGraphRequest,
  type EngineIndexRequest,
  type EngineSearchSymbolsRequest,
  type FileReadRequest,
  type FileStatRequest,
  type FileWriteRequest,
  type GitStatusRequest,
  type SetThemeRequest,
  type WorkspaceOpenRequest,
  type WorkspaceSearchRequest,
  type WorkspaceSession,
  type WorkspaceTreeRequest
} from "@codemind/shared";

/**
 * Restricted preload bridge.
 * Only explicitly approved, Zod-validated operations are exposed to the renderer.
 * No Node.js APIs, raw ipcRenderer, unrestricted fs, or shell execution are exposed.
 */
const desktopApi: CodeMindDesktopAPI = Object.freeze({
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),
  getPlatformInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_PLATFORM),
  healthCheck: () => ipcRenderer.invoke(IPC_CHANNELS.APP_HEALTH_CHECK),
  getTheme: () => ipcRenderer.invoke(IPC_CHANNELS.THEME_GET),
  setTheme: (request: SetThemeRequest) => ipcRenderer.invoke(IPC_CHANNELS.THEME_SET, request),
  selectWorkspaceFolder: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SELECT_FOLDER),
  openWorkspace: (request: WorkspaceOpenRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN, request),
  getWorkspaceSession: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_LAST),
  saveWorkspaceSession: (session: WorkspaceSession) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SAVE_SESSION, session),
  getWorkspaceTree: (request: WorkspaceTreeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_TREE, request),
  searchWorkspaceFiles: (request: WorkspaceSearchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SEARCH_FILES, request),
  getGitStatus: (request: GitStatusRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_GIT_STATUS, request),
  indexWorkspace: (request: EngineIndexRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENGINE_INDEX_WORKSPACE, request),
  searchSymbols: (request: EngineSearchSymbolsRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENGINE_SEARCH_SYMBOLS, request),
  getDependencyGraph: (request: EngineGraphRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENGINE_GET_GRAPH, request),
  getFileIntelligence: (request: EngineFileIntelRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.ENGINE_GET_FILE_INTEL, request),
  readFile: (request: FileReadRequest) => ipcRenderer.invoke(IPC_CHANNELS.FILE_READ, request),
  writeFile: (request: FileWriteRequest) => ipcRenderer.invoke(IPC_CHANNELS.FILE_WRITE, request),
  statFile: (request: FileStatRequest) => ipcRenderer.invoke(IPC_CHANNELS.FILE_STAT, request)
});

contextBridge.exposeInMainWorld("codemindDesktop", desktopApi);
