import {
  ThemePreferenceSchema,
  WorkspaceSessionSchema,
  type AppInfo,
  type CodeMindDesktopAPI,
  type DependencyGraphSnapshot,
  type EngineFileIntelRequest,
  type EngineGraphRequest,
  type EngineIndexRequest,
  type EngineSearchSymbolsRequest,
  type FileIntelligence,
  type FileReadRequest,
  type FileReadResult,
  type FileSearchMatch,
  type FileStatRequest,
  type FileStatResult,
  type FileTreeNode,
  type FileWriteRequest,
  type FileWriteResult,
  type GitStatus,
  type GitStatusRequest,
  type HealthCheckResponse,
  type IndexSummary,
  type IpcResponse,
  type PlatformInfo,
  type SymbolSearchResult,
  type ThemePreference,
  type WorkspaceInfo,
  type WorkspaceOpenRequest,
  type WorkspaceSearchRequest,
  type WorkspaceSession,
  type WorkspaceTreeRequest
} from "@codemind/shared";

const BROWSER_THEME_STORAGE_KEY = "codemind.theme.preference";
const BROWSER_SESSION_STORAGE_KEY = "codemind.workspace.session";

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

function readBrowserSession(): WorkspaceSession {
  const fallback: WorkspaceSession = {
    lastWorkspacePath: null,
    openTabPaths: [],
    activeTabPath: null,
    customExcludes: []
  };
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return fallback;
    }
    const raw = window.localStorage.getItem(BROWSER_SESSION_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = WorkspaceSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

function writeBrowserSession(session: WorkspaceSession): WorkspaceSession {
  const validated = WorkspaceSessionSchema.parse(session);
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(BROWSER_SESSION_STORAGE_KEY, JSON.stringify(validated));
    }
  } catch {
    // Ignore storage errors in browser preview.
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
  },

  async selectWorkspaceFolder(): Promise<IpcResponse<WorkspaceInfo | null>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Opening a local project folder requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.selectWorkspaceFolder(), "BRIDGE_WORKSPACE_SELECT_FAILED");
  },

  async openWorkspace(request: WorkspaceOpenRequest): Promise<IpcResponse<WorkspaceInfo>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Opening a local workspace requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.openWorkspace(request), "BRIDGE_WORKSPACE_OPEN_FAILED");
  },

  async getWorkspaceSession(): Promise<IpcResponse<WorkspaceSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: readBrowserSession() };
    }
    return safeInvoke(() => bridge.getWorkspaceSession(), "BRIDGE_WORKSPACE_SESSION_GET_FAILED");
  },

  async saveWorkspaceSession(session: WorkspaceSession): Promise<IpcResponse<WorkspaceSession>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: writeBrowserSession(session) };
    }
    return safeInvoke(
      () => bridge.saveWorkspaceSession(session),
      "BRIDGE_WORKSPACE_SESSION_SAVE_FAILED"
    );
  },

  async getWorkspaceTree(request: WorkspaceTreeRequest): Promise<IpcResponse<FileTreeNode[]>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: [] };
    }
    return safeInvoke(() => bridge.getWorkspaceTree(request), "BRIDGE_WORKSPACE_TREE_FAILED");
  },

  async searchWorkspaceFiles(
    request: WorkspaceSearchRequest
  ): Promise<IpcResponse<FileSearchMatch[]>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: [] };
    }
    return safeInvoke(() => bridge.searchWorkspaceFiles(request), "BRIDGE_WORKSPACE_SEARCH_FAILED");
  },

  async getGitStatus(request: GitStatusRequest): Promise<IpcResponse<GitStatus>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: { isGitRepo: false, branch: null, isDirty: false, modifiedCount: 0 }
      };
    }
    return safeInvoke(() => bridge.getGitStatus(request), "BRIDGE_GIT_STATUS_FAILED");
  },

  async indexWorkspace(request: EngineIndexRequest): Promise<IpcResponse<IndexSummary>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          workspaceRoot: request.workspaceRoot,
          totalFiles: 0,
          indexedFiles: 0,
          totalSymbols: 0,
          totalEdges: 0,
          diagnosticCount: 0,
          durationMs: 0,
          indexedAt: new Date().toISOString()
        }
      };
    }
    return safeInvoke(() => bridge.indexWorkspace(request), "BRIDGE_ENGINE_INDEX_FAILED");
  },

  async searchSymbols(
    request: EngineSearchSymbolsRequest
  ): Promise<IpcResponse<SymbolSearchResult[]>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: [] };
    }
    return safeInvoke(() => bridge.searchSymbols(request), "BRIDGE_ENGINE_SEARCH_SYMBOLS_FAILED");
  },

  async getDependencyGraph(
    request: EngineGraphRequest
  ): Promise<IpcResponse<DependencyGraphSnapshot>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: { nodes: [], edges: [] } };
    }
    return safeInvoke(() => bridge.getDependencyGraph(request), "BRIDGE_ENGINE_GRAPH_FAILED");
  },

  async getFileIntelligence(
    request: EngineFileIntelRequest
  ): Promise<IpcResponse<FileIntelligence>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: true,
        data: {
          filePath: request.relativePath,
          symbols: [],
          imports: [],
          exports: [],
          dependencies: [],
          dependents: [],
          diagnostics: []
        }
      };
    }
    return safeInvoke(() => bridge.getFileIntelligence(request), "BRIDGE_ENGINE_FILE_INTEL_FAILED");
  },

  async readFile(request: FileReadRequest): Promise<IpcResponse<FileReadResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Reading local files requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.readFile(request), "BRIDGE_FILE_READ_FAILED");
  },

  async writeFile(request: FileWriteRequest): Promise<IpcResponse<FileWriteResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return {
        ok: false,
        error: {
          code: "ELECTRON_REQUIRED",
          message: "Saving local files requires the CodeMind desktop application."
        }
      };
    }
    return safeInvoke(() => bridge.writeFile(request), "BRIDGE_FILE_WRITE_FAILED");
  },

  async statFile(request: FileStatRequest): Promise<IpcResponse<FileStatResult>> {
    const bridge = getBridge();
    if (!bridge) {
      return { ok: true, data: { exists: false } };
    }
    return safeInvoke(() => bridge.statFile(request), "BRIDGE_FILE_STAT_FAILED");
  }
};
