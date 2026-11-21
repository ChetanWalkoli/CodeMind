import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodeMindDesktopAPI } from "@codemind/shared";
import { desktopApi, isElectronEnvironment } from "../desktopApi";

function createMockBridge(overrides: Partial<CodeMindDesktopAPI> = {}): CodeMindDesktopAPI {
  return {
    getAppInfo: vi.fn().mockResolvedValue({
      ok: true,
      data: { name: "CodeMind", version: "0.1.0", platform: "win32" }
    }),
    getPlatformInfo: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        platform: "win32",
        arch: "x64",
        electronVersion: "45.4.1",
        nodeVersion: "24.22.3",
        chromeVersion: "156.0.0"
      }
    }),
    healthCheck: vi.fn().mockResolvedValue({
      ok: true,
      data: { status: "ready", timestamp: new Date().toISOString() }
    }),
    getTheme: vi.fn().mockResolvedValue({ ok: true, data: "dark" }),
    setTheme: vi.fn().mockResolvedValue({ ok: true, data: "light" }),
    selectWorkspaceFolder: vi.fn().mockResolvedValue({ ok: true, data: null }),
    openWorkspace: vi.fn().mockResolvedValue({
      ok: true,
      data: { rootPath: "C:\\demo", name: "demo" }
    }),
    getWorkspaceSession: vi.fn().mockResolvedValue({
      ok: true,
      data: { lastWorkspacePath: null, openTabPaths: [], activeTabPath: null, customExcludes: [] }
    }),
    saveWorkspaceSession: vi.fn().mockResolvedValue({
      ok: true,
      data: { lastWorkspacePath: null, openTabPaths: [], activeTabPath: null, customExcludes: [] }
    }),
    getWorkspaceTree: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    searchWorkspaceFiles: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getGitStatus: vi.fn().mockResolvedValue({
      ok: true,
      data: { isGitRepo: false, branch: null, isDirty: false, modifiedCount: 0 }
    }),
    indexWorkspace: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        workspaceRoot: "C:\\demo",
        totalFiles: 0,
        indexedFiles: 0,
        totalSymbols: 0,
        totalEdges: 0,
        diagnosticCount: 0,
        durationMs: 1,
        indexedAt: new Date().toISOString()
      }
    }),
    searchSymbols: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    getDependencyGraph: vi.fn().mockResolvedValue({ ok: true, data: { nodes: [], edges: [] } }),
    getFileIntelligence: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        filePath: "index.ts",
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        dependents: [],
        diagnostics: []
      }
    }),
    readFile: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        relativePath: "index.ts",
        content: "",
        contentHash: "hash",
        modifiedAtMs: 0,
        sizeBytes: 0,
        isSecret: false
      }
    }),
    writeFile: vi.fn().mockResolvedValue({
      ok: true,
      data: { relativePath: "index.ts", contentHash: "hash2", modifiedAtMs: 1, sizeBytes: 1 }
    }),
    statFile: vi.fn().mockResolvedValue({ ok: true, data: { exists: false } }),
    ...overrides
  };
}

describe("desktopApi service", () => {
  afterEach(() => {
    delete window.codemindDesktop;
    window.localStorage.clear();
  });

  it("uses safe browser fallback when running outside Electron", async () => {
    expect(isElectronEnvironment()).toBe(false);

    const appInfo = await desktopApi.getAppInfo();
    expect(appInfo.ok).toBe(true);
    if (appInfo.ok) {
      expect(appInfo.data.platform).toBe("browser");
    }

    const setRes = await desktopApi.setTheme("light");
    expect(setRes).toEqual({ ok: true, data: "light" });

    const getRes = await desktopApi.getTheme();
    expect(getRes).toEqual({ ok: true, data: "light" });
  });

  it("delegates to window.codemindDesktop when inside Electron and catches bridge rejections", async () => {
    window.codemindDesktop = createMockBridge({
      getPlatformInfo: vi.fn().mockRejectedValue(new Error("IPC channel closed"))
    });

    expect(isElectronEnvironment()).toBe(true);

    const appRes = await desktopApi.getAppInfo();
    expect(appRes).toEqual({
      ok: true,
      data: { name: "CodeMind", version: "0.1.0", platform: "win32" }
    });

    const platformRes = await desktopApi.getPlatformInfo();
    expect(platformRes.ok).toBe(false);
    if (!platformRes.ok) {
      expect(platformRes.error.code).toBe("BRIDGE_PLATFORM_INFO_FAILED");
    }
  });
});
