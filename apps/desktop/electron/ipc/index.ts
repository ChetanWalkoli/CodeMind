import { IPC_CHANNELS, type IpcResponse } from "@codemind/shared";
import { APPROVED_PHASE1_CHANNELS, type ApprovedPhase1Channel } from "./channels.js";
import { createAppHandlers, type AppRuntimeMetadata } from "./handlers/app.handler.js";
import { createThemeHandlers } from "./handlers/theme.handler.js";
import type { PreferencesStore } from "../utils/preferences.js";

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface IpcRegistrationDeps {
  metadata: AppRuntimeMetadata;
  preferences: PreferencesStore;
}

const registeredChannels = new Set<ApprovedPhase1Channel>();

function wrapHandler<T>(handler: (payload: unknown) => IpcResponse<T>) {
  return (_event: unknown, payload?: unknown): IpcResponse<T> => {
    try {
      return handler(payload);
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
  channel: ApprovedPhase1Channel,
  listener: (event: unknown, payload?: unknown) => unknown
) {
  if (registeredChannels.has(channel)) {
    return;
  }
  ipcMain.handle(channel, listener);
  registeredChannels.add(channel);
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcRegistrationDeps): void {
  const appHandlers = createAppHandlers(deps.metadata);
  const themeHandlers = createThemeHandlers(deps.preferences);

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
}

export function unregisterIpcHandlers(ipcMain: IpcMainLike): void {
  for (const channel of APPROVED_PHASE1_CHANNELS) {
    if (registeredChannels.has(channel)) {
      ipcMain.removeHandler(channel);
      registeredChannels.delete(channel);
    }
  }
}

export function getRegisteredIpcChannels(): ApprovedPhase1Channel[] {
  return Array.from(registeredChannels);
}
