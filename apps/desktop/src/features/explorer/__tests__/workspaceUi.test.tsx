import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeMindDesktopAPI } from "@codemind/shared";
import { App } from "../../../app/App";
import { useEditorStore } from "../../../stores/editor.store";
import { useLayoutStore } from "../../../stores/layout.store";
import { useThemeStore } from "../../../stores/theme.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";

vi.mock("../../../components/editor/monacoSetup", () => ({
  ensureMonacoConfigured: vi.fn()
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (val: string) => void }) => (
    <textarea
      data-testid="mock-monaco-textarea"
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
}));

describe("Phase 2 Workspace UI Integration", () => {
  beforeEach(() => {
    useEditorStore.getState().resetToInitial();
    useLayoutStore.getState().resetLayout();
    useWorkspaceStore.setState({
      activeNav: "explorer",
      activeBottomTab: "problems",
      workspace: null,
      rootNodes: [],
      childrenByPath: {},
      expandedPaths: {},
      loadingPaths: {},
      gitStatus: null,
      customExcludes: [],
      workspaceError: null
    });
    useThemeStore.setState({ theme: "dark", initialized: false });
    window.localStorage.clear();
  });

  afterEach(() => {
    delete window.codemindDesktop;
  });

  it("opens a workspace folder, expands nested folders, opens a file, and saves with Ctrl+S", async () => {
    const writeFileMock = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        relativePath: "src/app.ts",
        contentHash: "hash-2",
        modifiedAtMs: Date.now(),
        sizeBytes: 32
      }
    });

    const mockBridge: CodeMindDesktopAPI = {
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
      setTheme: vi.fn().mockResolvedValue({ ok: true, data: "dark" }),
      selectWorkspaceFolder: vi.fn().mockResolvedValue({
        ok: true,
        data: { rootPath: "C:\\projects\\demo", name: "demo" }
      }),
      openWorkspace: vi.fn().mockResolvedValue({
        ok: true,
        data: { rootPath: "C:\\projects\\demo", name: "demo" }
      }),
      getWorkspaceSession: vi.fn().mockResolvedValue({
        ok: true,
        data: { lastWorkspacePath: null, openTabPaths: [], activeTabPath: null, customExcludes: [] }
      }),
      saveWorkspaceSession: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          lastWorkspacePath: "C:\\projects\\demo",
          openTabPaths: [],
          activeTabPath: null,
          customExcludes: []
        }
      }),
      getWorkspaceTree: vi.fn().mockImplementation(async ({ relativeDir }) => {
        if (!relativeDir) {
          return {
            ok: true,
            data: [{ name: "src", relativePath: "src", kind: "directory", hasChildren: true }]
          };
        }
        return {
          ok: true,
          data: [{ name: "app.ts", relativePath: "src/app.ts", kind: "file", extension: ".ts" }]
        };
      }),
      searchWorkspaceFiles: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ name: "app.ts", relativePath: "src/app.ts", extension: ".ts" }]
      }),
      getGitStatus: vi.fn().mockResolvedValue({
        ok: true,
        data: { isGitRepo: true, branch: "main", isDirty: false, modifiedCount: 0 }
      }),
      indexWorkspace: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          workspaceRoot: "C:\\projects\\demo",
          totalFiles: 1,
          indexedFiles: 1,
          totalSymbols: 1,
          totalEdges: 0,
          diagnosticCount: 0,
          durationMs: 2,
          indexedAt: new Date().toISOString()
        }
      }),
      searchSymbols: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getDependencyGraph: vi.fn().mockResolvedValue({ ok: true, data: { nodes: [], edges: [] } }),
      getFileIntelligence: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          filePath: "src/app.ts",
          symbols: [],
          imports: [],
          exports: [],
          dependencies: [],
          dependents: [],
          diagnostics: []
        }
      }),
      getArchitectureOverview: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          workspaceRoot: "C:\\projects\\demo",
          totalFiles: 1,
          totalSymbols: 1,
          totalInternalEdges: 0,
          unresolvedImportCount: 0,
          diagnosticCount: 0,
          languages: [{ language: "typescript", count: 1 }],
          modules: [{ name: "src", fileCount: 1, symbolCount: 1 }],
          externalPackages: [],
          indexedAt: new Date().toISOString()
        }
      }),
      readFile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          relativePath: "src/app.ts",
          content: "export const a = 1;",
          contentHash: "hash-1",
          modifiedAtMs: Date.now(),
          sizeBytes: 19,
          isSecret: false
        }
      }),
      writeFile: writeFileMock,
      statFile: vi.fn().mockResolvedValue({
        ok: true,
        data: { exists: true, contentHash: "hash-1", modifiedAtMs: Date.now() }
      }),
      getAIConfig: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          availableModels: [{ id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }],
          hasApiKey: false,
          maskedKeyHint: null,
          encryptionAvailable: true,
          credentialCorrupt: false,
          statusError: null
        }
      }),
      setAIApiKey: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      clearAIApiKey: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      setAIModel: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      validateAIApiKey: vi.fn().mockResolvedValue({
        ok: true,
        data: { valid: false, status: "not_configured", message: "No key" }
      }),
      buildAIContext: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      searchAIContextFiles: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      resolveAIMissingFiles: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      approveAIContext: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      getAIContextApproval: vi.fn().mockResolvedValue({
        ok: true,
        data: { snapshotId: "snap", approved: false, approvedAt: null, expiresAt: null }
      }),
      executeApprovedAIContext: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      startAIStream: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      cancelAIStream: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { requestId: "r", cancelled: false } }),
      onAIStreamEvent: vi.fn().mockReturnValue(() => undefined),
      createAIConversation: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      listAIConversations: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getAIConversation: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      renameAIConversation: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      deleteAIConversation: vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } }),
      getAIUsageSummary: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          totalRequests: 0,
          succeededRequests: 0,
          failedRequests: 0,
          cancelledRequests: 0,
          providerReportedInputTokens: 0,
          providerReportedOutputTokens: 0,
          estimatedInputTokens: 0,
          averageDurationMs: 0,
          estimatedCostUsd: null,
          recentRequests: []
        }
      })
    };

    window.codemindDesktop = mockBridge;
    const user = userEvent.setup();
    render(<App />);

    // Open folder from Explorer empty state
    const openButtons = screen.getAllByRole("button", { name: /Open Folder/i });
    await user.click(openButtons[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("file-explorer")).toBeInTheDocument();
      expect(screen.getByTestId("status-git")).toHaveTextContent("main · Clean");
    });

    // Expand src folder and open src/app.ts
    await user.click(screen.getByRole("button", { name: "src" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "app.ts" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "app.ts" }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-monaco-textarea")).toHaveValue("export const a = 1;");
    });

    // Edit content and save with Ctrl+S
    const textarea = screen.getByTestId("mock-monaco-textarea");
    await user.type(textarea, "\nexport const b = 2;");
    expect(screen.getByTestId("status-file")).toHaveTextContent("app.ts (Modified)");

    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => {
      expect(writeFileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceRoot: "C:\\projects\\demo",
          relativePath: "src/app.ts",
          expectedContentHash: "hash-1"
        })
      );
      expect(screen.getByTestId("status-file")).toHaveTextContent("app.ts");
      expect(screen.getByTestId("status-file")).not.toHaveTextContent("(Modified)");
    });
  });

  it("shows external conflict dialog on write conflict and allows reloading from disk", async () => {
    const readFileMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          relativePath: "src/app.ts",
          content: "v1",
          contentHash: "hash-1",
          modifiedAtMs: 1,
          sizeBytes: 2,
          isSecret: false
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          relativePath: "src/app.ts",
          content: "external-v2",
          contentHash: "hash-external",
          modifiedAtMs: 2,
          sizeBytes: 11,
          isSecret: false
        }
      });

    window.codemindDesktop = {
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
      setTheme: vi.fn().mockResolvedValue({ ok: true, data: "dark" }),
      selectWorkspaceFolder: vi.fn().mockResolvedValue({
        ok: true,
        data: { rootPath: "C:\\projects\\demo", name: "demo" }
      }),
      openWorkspace: vi.fn().mockResolvedValue({
        ok: true,
        data: { rootPath: "C:\\projects\\demo", name: "demo" }
      }),
      getWorkspaceSession: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          lastWorkspacePath: "C:\\projects\\demo",
          openTabPaths: ["src/app.ts"],
          activeTabPath: "src/app.ts",
          customExcludes: []
        }
      }),
      saveWorkspaceSession: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          lastWorkspacePath: "C:\\projects\\demo",
          openTabPaths: ["src/app.ts"],
          activeTabPath: "src/app.ts",
          customExcludes: []
        }
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
          workspaceRoot: "C:\\projects\\demo",
          totalFiles: 1,
          indexedFiles: 1,
          totalSymbols: 1,
          totalEdges: 0,
          diagnosticCount: 0,
          durationMs: 2,
          indexedAt: new Date().toISOString()
        }
      }),
      searchSymbols: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getDependencyGraph: vi.fn().mockResolvedValue({ ok: true, data: { nodes: [], edges: [] } }),
      getFileIntelligence: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          filePath: "src/app.ts",
          symbols: [],
          imports: [],
          exports: [],
          dependencies: [],
          dependents: [],
          diagnostics: []
        }
      }),
      getArchitectureOverview: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          workspaceRoot: "C:\\projects\\demo",
          totalFiles: 1,
          totalSymbols: 1,
          totalInternalEdges: 0,
          unresolvedImportCount: 0,
          diagnosticCount: 0,
          languages: [{ language: "typescript", count: 1 }],
          modules: [{ name: "src", fileCount: 1, symbolCount: 1 }],
          externalPackages: [],
          indexedAt: new Date().toISOString()
        }
      }),
      readFile: readFileMock,
      writeFile: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "EXTERNAL_MODIFICATION_CONFLICT",
          message: "File modified externally"
        }
      }),
      statFile: vi.fn().mockResolvedValue({ ok: true, data: { exists: true } }),
      getAIConfig: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          availableModels: [{ id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }],
          hasApiKey: false,
          maskedKeyHint: null,
          encryptionAvailable: true,
          credentialCorrupt: false,
          statusError: null
        }
      }),
      setAIApiKey: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      clearAIApiKey: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      setAIModel: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      validateAIApiKey: vi.fn().mockResolvedValue({
        ok: true,
        data: { valid: false, status: "not_configured", message: "No key" }
      }),
      buildAIContext: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      searchAIContextFiles: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      resolveAIMissingFiles: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      approveAIContext: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      getAIContextApproval: vi.fn().mockResolvedValue({
        ok: true,
        data: { snapshotId: "snap", approved: false, approvedAt: null, expiresAt: null }
      }),
      executeApprovedAIContext: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      startAIStream: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      cancelAIStream: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { requestId: "r", cancelled: false } }),
      onAIStreamEvent: vi.fn().mockReturnValue(() => undefined),
      createAIConversation: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      listAIConversations: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getAIConversation: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      renameAIConversation: vi
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "NOOP", message: "noop" } }),
      deleteAIConversation: vi.fn().mockResolvedValue({ ok: true, data: { deleted: true } }),
      getAIUsageSummary: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          totalRequests: 0,
          succeededRequests: 0,
          failedRequests: 0,
          cancelledRequests: 0,
          providerReportedInputTokens: 0,
          providerReportedOutputTokens: 0,
          estimatedInputTokens: 0,
          averageDurationMs: 0,
          estimatedCostUsd: null,
          recentRequests: []
        }
      })
    };

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("mock-monaco-textarea")).toHaveValue("v1");
    });

    await user.type(screen.getByTestId("mock-monaco-textarea"), "-local");
    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => {
      expect(screen.getByText("File changed on disk")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Reload from Disk/i }));
    await waitFor(() => {
      expect(screen.getByTestId("mock-monaco-textarea")).toHaveValue("external-v2");
    });
  });
});
