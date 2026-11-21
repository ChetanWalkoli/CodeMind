import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeMindDesktopAPI } from "@codemind/shared";
import { App } from "../../../app/App";
import { useArchitectureStore } from "../../../stores/architecture.store";
import { useEditorStore } from "../../../stores/editor.store";
import { useLayoutStore } from "../../../stores/layout.store";
import { useThemeStore } from "../../../stores/theme.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";

vi.mock("../../../components/editor/monacoSetup", () => ({
  ensureMonacoConfigured: vi.fn()
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value }: { value?: string }) => (
    <textarea data-testid="mock-monaco-textarea" readOnly value={value ?? ""} />
  )
}));

describe("Phase 4 Architecture Explorer & Source Navigation", () => {
  beforeEach(() => {
    useEditorStore.getState().resetToInitial();
    useLayoutStore.getState().resetLayout();
    useArchitectureStore.getState().clear();
    useWorkspaceStore.setState({
      activeNav: "explorer",
      activeBottomTab: "problems",
      centerView: "editor",
      workspace: null,
      rootNodes: [],
      childrenByPath: {},
      expandedPaths: {},
      loadingPaths: {},
      gitStatus: null,
      indexSummary: null,
      isIndexing: false,
      customExcludes: [],
      workspaceError: null
    });
    useThemeStore.setState({ theme: "dark", initialized: false });
    window.localStorage.clear();
  });

  afterEach(() => {
    delete window.codemindDesktop;
  });

  it("displays overview metrics, inspects file/symbol relationships, and navigates to Monaco line", async () => {
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
      selectWorkspaceFolder: vi.fn().mockResolvedValue({ ok: true, data: null }),
      openWorkspace: vi.fn().mockResolvedValue({
        ok: true,
        data: { rootPath: "C:\\projects\\demo", name: "demo" }
      }),
      getWorkspaceSession: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          lastWorkspacePath: "C:\\projects\\demo",
          openTabPaths: [],
          activeTabPath: null,
          customExcludes: []
        }
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
          totalFiles: 2,
          indexedFiles: 2,
          totalSymbols: 3,
          totalEdges: 1,
          diagnosticCount: 0,
          durationMs: 4,
          indexedAt: "2026-11-21T00:00:00.000Z"
        }
      }),
      searchSymbols: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      getArchitectureOverview: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          workspaceRoot: "C:\\projects\\demo",
          totalFiles: 2,
          totalSymbols: 3,
          totalInternalEdges: 1,
          unresolvedImportCount: 1,
          diagnosticCount: 0,
          languages: [{ language: "typescript", count: 2 }],
          modules: [{ name: "src", fileCount: 2, symbolCount: 3 }],
          externalPackages: [{ name: "react", importCount: 1 }],
          indexedAt: "2026-11-21T00:00:00.000Z"
        }
      }),
      getDependencyGraph: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          nodes: [
            {
              id: "src/authService.ts",
              path: "src/authService.ts",
              language: "typescript",
              contentHash: "h1",
              lastIndexedAt: "2026-11-21T00:00:00.000Z"
            },
            {
              id: "src/login.ts",
              path: "src/login.ts",
              language: "typescript",
              contentHash: "h2",
              lastIndexedAt: "2026-11-21T00:00:00.000Z"
            }
          ],
          edges: [
            {
              sourceId: "src/login.ts",
              targetId: "src/authService.ts",
              relation: "imports",
              confidence: "confirmed"
            }
          ]
        }
      }),
      getFileIntelligence: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          filePath: "src/authService.ts",
          symbols: [
            {
              id: "src/authService.ts::function::verifyToken::12",
              filePath: "src/authService.ts",
              name: "verifyToken",
              kind: "function",
              startLine: 12,
              endLine: 20,
              exported: true
            }
          ],
          imports: [
            {
              sourcePath: "src/authService.ts",
              specifier: "react",
              resolvedPath: null,
              isExternal: true,
              kind: "static-import",
              importedNames: ["default"],
              line: 1,
              confidence: "confirmed"
            },
            {
              sourcePath: "src/authService.ts",
              specifier: "./missing",
              resolvedPath: null,
              isExternal: false,
              kind: "static-import",
              importedNames: [],
              line: 2,
              confidence: "confirmed"
            }
          ],
          exports: [
            { filePath: "src/authService.ts", name: "verifyToken", kind: "named", line: 12 }
          ],
          dependencies: [],
          dependents: [
            {
              sourceId: "src/login.ts",
              targetId: "src/authService.ts",
              relation: "imports",
              confidence: "confirmed"
            }
          ],
          diagnostics: []
        }
      }),
      readFile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          relativePath: "src/authService.ts",
          content: "// auth service code\nexport function verifyToken() { return true; }",
          contentHash: "h1",
          modifiedAtMs: 1,
          sizeBytes: 64,
          isSecret: false
        }
      }),
      writeFile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          relativePath: "src/authService.ts",
          contentHash: "h2",
          modifiedAtMs: 2,
          sizeBytes: 10
        }
      }),
      statFile: vi.fn().mockResolvedValue({ ok: true, data: { exists: true } })
    };

    window.codemindDesktop = mockBridge;
    const user = userEvent.setup();
    render(<App />);

    // Open Codebase Graph from ActivityBar
    await user.click(screen.getByRole("button", { name: "Codebase Graph" }));

    await waitFor(() => {
      expect(screen.getByTestId("architecture-overview-panel")).toBeInTheDocument();
      expect(screen.getByTestId("overview-total-files")).toHaveTextContent("2");
      expect(screen.getByTestId("overview-total-symbols")).toHaveTextContent("3");
      expect(screen.getByTestId("architecture-explorer")).toBeInTheDocument();
    });

    // Select a file node in the architecture store (simulating clicking node in React Flow)
    await useArchitectureStore.getState().selectNode("C:\\projects\\demo", "src/authService.ts");

    await waitFor(() => {
      expect(screen.getByTestId("architecture-inspector")).toBeInTheDocument();
      expect(screen.getByText("src/login.ts")).toBeInTheDocument();
      expect(screen.getByText("./missing")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /verifyToken\s+function/i })).toBeInTheDocument();
    });

    // Select symbol to inspect details & jump to source line in Monaco
    await user.click(screen.getByRole("button", { name: /verifyToken\s+function/i }));
    expect(screen.getByTestId("symbol-detail-card")).toBeInTheDocument();
    expect(screen.getByText(/Cross-file symbol call\/reference graphs/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Jump to Line 12/i }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().centerView).toBe("editor");
      expect(screen.getByTestId("mock-monaco-textarea")).toHaveValue(
        "// auth service code\nexport function verifyToken() { return true; }"
      );
      expect(useEditorStore.getState().cursor).toEqual({ line: 12, column: 1 });
    });
  });
});
