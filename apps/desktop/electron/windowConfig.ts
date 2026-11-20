import type { BrowserWindowConstructorOptions } from "electron";
import type { ThemePreference } from "@codemind/shared";

export const WINDOW_DEFAULTS = {
  WIDTH: 1440,
  HEIGHT: 900,
  MIN_WIDTH: 1000,
  MIN_HEIGHT: 650,
  TITLE: "CodeMind"
} as const;

export function getWindowBackgroundColor(theme: ThemePreference): string {
  return theme === "light" ? "#ffffff" : "#111111";
}

export function buildMainWindowOptions(
  preloadPath: string,
  theme: ThemePreference
): BrowserWindowConstructorOptions {
  return {
    width: WINDOW_DEFAULTS.WIDTH,
    height: WINDOW_DEFAULTS.HEIGHT,
    minWidth: WINDOW_DEFAULTS.MIN_WIDTH,
    minHeight: WINDOW_DEFAULTS.MIN_HEIGHT,
    title: WINDOW_DEFAULTS.TITLE,
    backgroundColor: getWindowBackgroundColor(theme),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  };
}
