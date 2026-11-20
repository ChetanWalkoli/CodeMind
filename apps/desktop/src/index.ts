import { APP_CONSTANTS } from "@codemind/config";
import { IPC_CHANNELS } from "@codemind/shared";

/**
 * Phase 0 placeholder verifying desktop app boundary and shared contract imports.
 * Electron main/preload/renderer shell and Monaco editor will be built in Phase 1.
 */
export const DESKTOP_BOOTSTRAP = {
  appName: APP_CONSTANTS.APP_NAME,
  ipcChannels: IPC_CHANNELS
} as const;
