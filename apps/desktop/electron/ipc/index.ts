import { IPC_CHANNELS, type IpcResponse } from "@codemind/shared";
import { APPROVED_IPC_CHANNELS, type ApprovedIpcChannel } from "./channels.js";
import { createAppHandlers, type AppRuntimeMetadata } from "./handlers/app.handler.js";
import { CodeEngineManager, createEngineHandlers } from "./handlers/engine.handler.js";
import { createFileHandlers } from "./handlers/file.handler.js";
import { createThemeHandlers } from "./handlers/theme.handler.js";
import { createWorkspaceHandlers, type SelectFolderFn } from "./handlers/workspace.handler.js";
import type { PreferencesStore } from "../utils/preferences.js";
import { WorkspaceFileService } from "../workspace/filesystem.js";
import { WorkspaceAuthority } from "../workspace/pathSecurity.js";

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface IpcRegistrationDeps {
  metadata: AppRuntimeMetadata;
  preferences: PreferencesStore;
  authority?: WorkspaceAuthority;
  fileService?: WorkspaceFileService;
  engineManager?: CodeEngineManager;
  selectFolder?: SelectFolderFn;
}

const registeredChannels = new Set<ApprovedIpcChannel>();

function wrapHandler<T>(handler: (payload: unknown) => IpcResponse<T> | Promise<IpcResponse<T>>) {
  return async (_event: unknown, payload?: unknown): Promise<IpcResponse<T>> => {
    try {
      return await handler(payload);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "INTERNAL_IPC_ERROR",
          message: err instanceof Error ? err.message : "Unexpected IPC error."
        }
      };
    }
  };
}

function registerSafe(
  ipcMain: IpcMainLike,
  channel: ApprovedIpcChannel,
  listener: (event: unknown, payload?: unknown) => unknown
) {
  if (registeredChannels.has(channel)) {
    return;
  }
  ipcMain.handle(channel, listener);
  registeredChannels.add(channel);
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcRegistrationDeps): void {
  const authority = deps.authority ?? new WorkspaceAuthority();
  const fileService = deps.fileService ?? new WorkspaceFileService(authority);
  const engineManager = deps.engineManager ?? new CodeEngineManager();
  const selectFolder = deps.selectFolder ?? (async () => null);

  const appHandlers = createAppHandlers(deps.metadata);
  const themeHandlers = createThemeHandlers(deps.preferences);
  const workspaceHandlers = createWorkspaceHandlers({
    fileService,
    preferences: deps.preferences,
    selectFolder
  });
  const engineHandlers = createEngineHandlers({
    authority,
    preferences: deps.preferences,
    engineManager
  });
  const fileHandlers = createFileHandlers(fileService, async (workspaceRoot, relativePath) => {
    const realRoot = authority.getAuthorizedRoot(workspaceRoot);
    await engineManager.notifyFileSaved(realRoot, relativePath);
  });

  registerSafe(
    ipcMain,
    IPC_CHANNELS.APP_GET_INFO,
    wrapHandler(() => appHandlers.getAppInfo())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.APP_GET_PLATFORM,
    wrapHandler(() => appHandlers.getPlatformInfo())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.APP_HEALTH_CHECK,
    wrapHandler(() => appHandlers.healthCheck())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.THEME_GET,
    wrapHandler(() => themeHandlers.getTheme())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.THEME_SET,
    wrapHandler((payload) => themeHandlers.setTheme(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_SELECT_FOLDER,
    wrapHandler(() => workspaceHandlers.selectFolder())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_OPEN,
    wrapHandler((payload) => workspaceHandlers.openWorkspace(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_GET_LAST,
    wrapHandler(() => workspaceHandlers.getWorkspaceSession())
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_SAVE_SESSION,
    wrapHandler((payload) => workspaceHandlers.saveWorkspaceSession(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_GET_TREE,
    wrapHandler((payload) => workspaceHandlers.getWorkspaceTree(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_SEARCH_FILES,
    wrapHandler((payload) => workspaceHandlers.searchWorkspaceFiles(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.WORKSPACE_GET_GIT_STATUS,
    wrapHandler((payload) => workspaceHandlers.getGitStatus(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.ENGINE_INDEX_WORKSPACE,
    wrapHandler((payload) => engineHandlers.indexWorkspace(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.ENGINE_SEARCH_SYMBOLS,
    wrapHandler((payload) => engineHandlers.searchSymbols(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.ENGINE_GET_GRAPH,
    wrapHandler((payload) => engineHandlers.getDependencyGraph(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.ENGINE_GET_FILE_INTEL,
    wrapHandler((payload) => engineHandlers.getFileIntelligence(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.FILE_READ,
    wrapHandler((payload) => fileHandlers.readFile(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.FILE_WRITE,
    wrapHandler((payload) => fileHandlers.writeFile(payload))
  );

  registerSafe(
    ipcMain,
    IPC_CHANNELS.FILE_STAT,
    wrapHandler((payload) => fileHandlers.statFile(payload))
  );
}

export function unregisterIpcHandlers(ipcMain: IpcMainLike): void {
  for (const channel of APPROVED_IPC_CHANNELS) {
    if (registeredChannels.has(channel)) {
      ipcMain.removeHandler(channel);
      registeredChannels.delete(channel);
    }
  }
}

export function getRegisteredIpcChannels(): ApprovedIpcChannel[] {
  return Array.from(registeredChannels);
}
