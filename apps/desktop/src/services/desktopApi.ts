import {
  ThemePreferenceSchema,
  type AppInfo,
  type CodeMindDesktopAPI,
  type HealthCheckResponse,
  type IpcResponse,
  type PlatformInfo,
  type ThemePreference
} from "@codemind/shared";

const BROWSER_THEME_STORAGE_KEY = "codemind.theme.preference";

function getBridge(): CodeMindDesktopAPI | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.codemindDesktop;
}

export function isElectronEnvironment(): boolean {
  return Boolean(getBridge());
}

function readBrowserTheme(): ThemePreference {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return "dark";
    }
    const raw = window.localStorage.getItem(BROWSER_THEME_STORAGE_KEY);
    const parsed = ThemePreferenceSchema.safeParse(raw);
    return parsed.success ? parsed.data : "dark";
  } catch {
    return "dark";
  }
}

function writeBrowserTheme(theme: ThemePreference): ThemePreference {
  const validated = ThemePreferenceSchema.parse(theme);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(BROWSER_THEME_STORAGE_KEY, validated);
    }
  } catch {
    // Ignore storage quota or restricted storage errors in browser preview.
  }
  return validated;
}

async function safeInvoke<T>(
  operation: () => Promise<IpcResponse<T>>,
  fallbackErrorCode: string
): Promise<IpcResponse<T>> {
  try {
    return await operation();
  } catch (err) {
    return {
      ok: false,
      error: {
        code: fallbackErrorCode,
        message: err instanceof Error ? err.message : "Desktop bridge invocation failed."
      }
    };
  }
}

export const desktopApi = {
  isElectron(): boolean {
    return isElectronEnvironment();
  },

  async getAppInfo(): Promise<IpcResponse<AppInfo>> {
    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(() => bridge.getAppInfo(), "BRIDGE_APP_INFO_FAILED");
    }

    return {
      ok: true,
      data: {
        name: "CodeMind",
        version: "0.1.0",
        platform: "browser"
      }
    };
  },

  async getPlatformInfo(): Promise<IpcResponse<PlatformInfo>> {
    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(() => bridge.getPlatformInfo(), "BRIDGE_PLATFORM_INFO_FAILED");
    }

    return {
      ok: true,
      data: {
        platform: "browser",
        arch: "web",
        electronVersion: "n/a",
        nodeVersion: "n/a",
        chromeVersion: typeof navigator !== "undefined" ? navigator.userAgent : "unknown"
      }
    };
  },

  async healthCheck(): Promise<IpcResponse<HealthCheckResponse>> {
    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(() => bridge.healthCheck(), "BRIDGE_HEALTH_CHECK_FAILED");
    }

    return {
      ok: true,
      data: {
        status: "ready",
        timestamp: new Date().toISOString()
      }
    };
  },

  async getTheme(): Promise<IpcResponse<ThemePreference>> {
    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(() => bridge.getTheme(), "BRIDGE_THEME_GET_FAILED");
    }

    return {
      ok: true,
      data: readBrowserTheme()
    };
  },

  async setTheme(theme: ThemePreference): Promise<IpcResponse<ThemePreference>> {
    const validated = ThemePreferenceSchema.safeParse(theme);
    if (!validated.success) {
      return {
        ok: false,
        error: {
          code: "INVALID_THEME",
          message: "Theme must be 'dark' or 'light'."
        }
      };
    }

    const bridge = getBridge();
    if (bridge) {
      return safeInvoke(
        () => bridge.setTheme({ theme: validated.data }),
        "BRIDGE_THEME_SET_FAILED"
      );
    }

    return {
      ok: true,
      data: writeBrowserTheme(validated.data)
    };
  }
};
