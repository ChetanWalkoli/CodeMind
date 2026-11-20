// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@codemind/shared";
import { APPROVED_IPC_CHANNELS, isApprovedIpcChannel } from "../ipc/channels.js";
import {
  getRegisteredIpcChannels,
  registerIpcHandlers,
  unregisterIpcHandlers,
  type IpcMainLike
} from "../ipc/index.js";
import { PreferencesStore } from "../utils/preferences.js";
import { buildMainWindowOptions, WINDOW_DEFAULTS } from "../windowConfig.js";

class MockIpcMain implements IpcMainLike {
  public handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  async invoke(channel: string, payload?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for channel: ${channel}`);
    }
    return handler({}, payload);
  }
}

describe("Electron main security & IPC foundation", () => {
  let tempDir: string;
  let ipcMain: MockIpcMain;
  let preferences: PreferencesStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-test-"));
    ipcMain = new MockIpcMain();
    preferences = new PreferencesStore(tempDir);

    registerIpcHandlers(ipcMain, {
      metadata: {
        name: "CodeMind",
        version: "0.1.0",
        platform: "win32",
        arch: "x64",
        electronVersion: "45.4.1",
        nodeVersion: "24.22.3",
        chromeVersion: "156.0.0"
      },
      preferences
    });
  });

  afterEach(() => {
    unregisterIpcHandlers(ipcMain);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("enforces secure BrowserWindow webPreferences and dimensions", () => {
    const options = buildMainWindowOptions("/app/dist-electron/preload.cjs", "dark");

    expect(options.width).toBe(WINDOW_DEFAULTS.WIDTH);
    expect(options.height).toBe(WINDOW_DEFAULTS.HEIGHT);
    expect(options.minWidth).toBe(WINDOW_DEFAULTS.MIN_WIDTH);
    expect(options.minHeight).toBe(WINDOW_DEFAULTS.MIN_HEIGHT);
    expect(options.title).toBe("CodeMind");
    expect(options.webPreferences?.contextIsolation).toBe(true);
    expect(options.webPreferences?.nodeIntegration).toBe(false);
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.webSecurity).toBe(true);
  });

  it("registers only explicitly approved IPC channels and rejects unknown/shell channels", () => {
    const registered = getRegisteredIpcChannels();
    expect(registered).toEqual(expect.arrayContaining([...APPROVED_IPC_CHANNELS]));
    expect(registered).toHaveLength(APPROVED_IPC_CHANNELS.length);

    expect(isApprovedIpcChannel("shell:exec")).toBe(false);
    expect(isApprovedIpcChannel("fs:delete-any")).toBe(false);
    expect(ipcMain.handlers.has("shell:exec")).toBe(false);
  });

  it("prevents duplicate IPC handler registration", () => {
    const spy = vi.spyOn(ipcMain, "handle");
    registerIpcHandlers(ipcMain, {
      metadata: {
        name: "CodeMind",
        version: "0.1.0",
        platform: "win32",
        arch: "x64",
        electronVersion: "45.4.1",
        nodeVersion: "24.22.3",
        chromeVersion: "156.0.0"
      },
      preferences
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns validated app info, platform info, and health check", async () => {
    const appRes = (await ipcMain.invoke(IPC_CHANNELS.APP_GET_INFO)) as {
      ok: boolean;
      data: { name: string };
    };
    expect(appRes.ok).toBe(true);
    expect(appRes.data.name).toBe("CodeMind");

    const platRes = (await ipcMain.invoke(IPC_CHANNELS.APP_GET_PLATFORM)) as {
      ok: boolean;
      data: { arch: string };
    };
    expect(platRes.ok).toBe(true);
    expect(platRes.data.arch).toBe("x64");

    const healthRes = (await ipcMain.invoke(IPC_CHANNELS.APP_HEALTH_CHECK)) as {
      ok: boolean;
      data: { status: string };
    };
    expect(healthRes.ok).toBe(true);
    expect(healthRes.data.status).toBe("ready");
  });

  it("persists theme preferences across PreferencesStore instances and rejects invalid payloads", async () => {
    const initial = (await ipcMain.invoke(IPC_CHANNELS.THEME_GET)) as { ok: boolean; data: string };
    expect(initial).toEqual({ ok: true, data: "dark" });

    const invalid = (await ipcMain.invoke(IPC_CHANNELS.THEME_SET, { theme: "neon-purple" })) as {
      ok: boolean;
      error: { code: string };
    };
    expect(invalid.ok).toBe(false);
    expect(invalid.error.code).toBe("INVALID_PAYLOAD");

    const updated = (await ipcMain.invoke(IPC_CHANNELS.THEME_SET, { theme: "light" })) as {
      ok: boolean;
      data: string;
    };
    expect(updated).toEqual({ ok: true, data: "light" });

    const reloadedStore = new PreferencesStore(tempDir);
    expect(reloadedStore.getTheme()).toBe("light");
  });

  it("falls back safely to dark theme when preferences.json is corrupted", () => {
    fs.writeFileSync(path.join(tempDir, "preferences.json"), "{corrupted-json", "utf8");
    const store = new PreferencesStore(tempDir);
    expect(store.getTheme()).toBe("dark");
  });
});
