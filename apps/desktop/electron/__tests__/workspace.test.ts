// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  type FileReadResult,
  type FileTreeNode,
  type IpcResponse
} from "@codemind/shared";
import { registerIpcHandlers, unregisterIpcHandlers, type IpcMainLike } from "../ipc/index.js";
import { PreferencesStore } from "../utils/preferences.js";
import { WorkspaceFileService } from "../workspace/filesystem.js";
import { detectGitStatus } from "../workspace/gitStatus.js";
import { IgnoreMatcher } from "../workspace/ignoreRules.js";
import { WorkspaceAuthority } from "../workspace/pathSecurity.js";

class MockIpcMain implements IpcMainLike {
  public handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  async invoke<T>(channel: string, payload?: unknown): Promise<IpcResponse<T>> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for channel: ${channel}`);
    }
    return (await handler({}, payload)) as IpcResponse<T>;
  }
}

describe("Phase 2 Workspace & Local Filesystem Engine", () => {
  let rootTempDir: string;
  let workspaceDir: string;
  let outsideDir: string;
  let prefsDir: string;
  let ipcMain: MockIpcMain;
  let preferences: PreferencesStore;
  let authority: WorkspaceAuthority;
  let fileService: WorkspaceFileService;

  beforeEach(() => {
    rootTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-p2-"));
    workspaceDir = path.join(rootTempDir, "sample-project");
    outsideDir = path.join(rootTempDir, "outside-secret");
    prefsDir = path.join(rootTempDir, "user-data");

    fs.mkdirSync(path.join(workspaceDir, "src", "components"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "empty-dir"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "dist"), { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });

    fs.writeFileSync(path.join(workspaceDir, ".gitignore"), "ignored-dir/\n*.log\n", "utf8");
    fs.mkdirSync(path.join(workspaceDir, "ignored-dir"), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "ignored-dir", "hidden.ts"), "export {};", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "debug.log"), "log output", "utf8");
    fs.writeFileSync(path.join(workspaceDir, ".env"), "API_KEY=secret123", "utf8");
    fs.writeFileSync(
      path.join(workspaceDir, "src", "index.ts"),
      'export const greeting = "hello";\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceDir, "src", "components", "Header.tsx"),
      "export function Header() { return null; }\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceDir, "node_modules", "pkg", "index.js"),
      "module.exports = {};"
    );
    fs.writeFileSync(path.join(workspaceDir, "dist", "bundle.js"), "console.log(1);");
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "top secret", "utf8");

    ipcMain = new MockIpcMain();
    preferences = new PreferencesStore(prefsDir);
    authority = new WorkspaceAuthority();
    fileService = new WorkspaceFileService(authority);

    registerIpcHandlers(ipcMain, {
      metadata: {
        name: "CodeMind",
        version: "0.1.0",
        platform: process.platform,
        arch: process.arch,
        electronVersion: "45.4.1",
        nodeVersion: process.versions.node,
        chromeVersion: "156.0.0"
      },
      preferences,
      authority,
      fileService,
      selectFolder: async () => workspaceDir
    });
  });

  afterEach(() => {
    unregisterIpcHandlers(ipcMain);
    fs.rmSync(rootTempDir, { recursive: true, force: true });
  });

  it("opens a workspace via folder selection and persists last workspace path", async () => {
    const res = await ipcMain.invoke<{ rootPath: string; name: string } | null>(
      IPC_CHANNELS.WORKSPACE_SELECT_FOLDER
    );
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      expect(res.data.name).toBe("sample-project");
      expect(fs.realpathSync(res.data.rootPath)).toBe(fs.realpathSync(workspaceDir));
    }

    // Verify persistence across PreferencesStore restart
    const reloaded = new PreferencesStore(prefsDir);
    expect(reloaded.getWorkspaceSession().lastWorkspacePath).toBe(fs.realpathSync(workspaceDir));
  });

  it("generates filtered file tree excluding node_modules, dist, and .gitignore entries", async () => {
    const openRes = await ipcMain.invoke<{ rootPath: string }>(IPC_CHANNELS.WORKSPACE_OPEN, {
      rootPath: workspaceDir
    });
    expect(openRes.ok).toBe(true);
    const rootPath = openRes.ok ? openRes.data.rootPath : workspaceDir;

    const treeRes = await ipcMain.invoke<FileTreeNode[]>(IPC_CHANNELS.WORKSPACE_GET_TREE, {
      workspaceRoot: rootPath
    });
    expect(treeRes.ok).toBe(true);
    if (treeRes.ok) {
      const names = treeRes.data.map((n) => n.name);
      expect(names).toContain("src");
      expect(names).toContain("empty-dir");
      expect(names).toContain(".env");
      expect(names).not.toContain("node_modules");
      expect(names).not.toContain("dist");
      expect(names).not.toContain("ignored-dir");
      expect(names).not.toContain("debug.log");

      const envNode = treeRes.data.find((n) => n.name === ".env");
      expect(envNode?.isSecret).toBe(true);

      const emptyDirNode = treeRes.data.find((n) => n.name === "empty-dir");
      expect(emptyDirNode?.hasChildren).toBe(false);
    }
  });

  it("reads and writes files with content hash verification and external conflict protection", async () => {
    const openRes = await ipcMain.invoke<{ rootPath: string }>(IPC_CHANNELS.WORKSPACE_OPEN, {
      rootPath: workspaceDir
    });
    const rootPath = openRes.ok ? openRes.data.rootPath : workspaceDir;

    const readRes = await ipcMain.invoke<FileReadResult>(IPC_CHANNELS.FILE_READ, {
      workspaceRoot: rootPath,
      relativePath: "src/index.ts"
    });
    expect(readRes.ok).toBe(true);
    if (!readRes.ok) return;

    expect(readRes.data.content).toContain("hello");
    const originalHash = readRes.data.contentHash;

    // Valid write with matching hash succeeds
    const writeRes = await ipcMain.invoke<{ contentHash: string }>(IPC_CHANNELS.FILE_WRITE, {
      workspaceRoot: rootPath,
      relativePath: "src/index.ts",
      content: 'export const greeting = "updated";\n',
      expectedContentHash: originalHash
    });
    expect(writeRes.ok).toBe(true);

    // Simulate external modification on disk
    fs.writeFileSync(
      path.join(workspaceDir, "src", "index.ts"),
      'export const greeting = "external";\n',
      "utf8"
    );

    // Attempting to write with stale hash is rejected with EXTERNAL_MODIFICATION_CONFLICT
    const conflictRes = await ipcMain.invoke(IPC_CHANNELS.FILE_WRITE, {
      workspaceRoot: rootPath,
      relativePath: "src/index.ts",
      content: 'export const greeting = "overwrite";\n',
      expectedContentHash: writeRes.ok ? writeRes.data.contentHash : originalHash
    });
    expect(conflictRes.ok).toBe(false);
    if (!conflictRes.ok) {
      expect(conflictRes.error.code).toBe("EXTERNAL_MODIFICATION_CONFLICT");
    }
  });

  it("rejects unauthorized workspaces, path traversal attempts, and missing files", async () => {
    // Unauthorized workspace root
    const unauthRes = await ipcMain.invoke(IPC_CHANNELS.FILE_READ, {
      workspaceRoot: outsideDir,
      relativePath: "secret.txt"
    });
    expect(unauthRes.ok).toBe(false);
    if (!unauthRes.ok) {
      expect(unauthRes.error.code).toBe("UNAUTHORIZED_WORKSPACE");
    }

    const openRes = await ipcMain.invoke<{ rootPath: string }>(IPC_CHANNELS.WORKSPACE_OPEN, {
      rootPath: workspaceDir
    });
    const rootPath = openRes.ok ? openRes.data.rootPath : workspaceDir;

    // Relative path traversal
    const traversalRes = await ipcMain.invoke(IPC_CHANNELS.FILE_READ, {
      workspaceRoot: rootPath,
      relativePath: "../outside-secret/secret.txt"
    });
    expect(traversalRes.ok).toBe(false);
    if (!traversalRes.ok) {
      expect(traversalRes.error.code).toBe("PATH_TRAVERSAL");
    }

    // Absolute path injection
    const absRes = await ipcMain.invoke(IPC_CHANNELS.FILE_READ, {
      workspaceRoot: rootPath,
      relativePath: path.join(outsideDir, "secret.txt")
    });
    expect(absRes.ok).toBe(false);
    if (!absRes.ok) {
      expect(absRes.error.code).toBe("PATH_TRAVERSAL");
    }

    // Missing file inside authorized workspace
    const missingRes = await ipcMain.invoke(IPC_CHANNELS.FILE_READ, {
      workspaceRoot: rootPath,
      relativePath: "src/does-not-exist.ts"
    });
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.error.code).toBe("FILE_NOT_FOUND");
    }
  });

  it("searches filenames case-insensitively while excluding ignored directories", async () => {
    const openRes = await ipcMain.invoke<{ rootPath: string }>(IPC_CHANNELS.WORKSPACE_OPEN, {
      rootPath: workspaceDir
    });
    const rootPath = openRes.ok ? openRes.data.rootPath : workspaceDir;

    const searchRes = await ipcMain.invoke<{ relativePath: string }[]>(
      IPC_CHANNELS.WORKSPACE_SEARCH_FILES,
      {
        workspaceRoot: rootPath,
        query: "header"
      }
    );
    expect(searchRes.ok).toBe(true);
    if (searchRes.ok) {
      expect(searchRes.data.map((m) => m.relativePath)).toEqual(["src/components/Header.tsx"]);
    }

    const ignoredSearch = await ipcMain.invoke<{ relativePath: string }[]>(
      IPC_CHANNELS.WORKSPACE_SEARCH_FILES,
      {
        workspaceRoot: rootPath,
        query: "bundle"
      }
    );
    expect(ignoredSearch.ok).toBe(true);
    if (ignoredSearch.ok) {
      expect(ignoredSearch.data).toHaveLength(0);
    }
  });

  it("evaluates ignore rules and secret file patterns accurately", () => {
    const matcher = new IgnoreMatcher({
      gitignoreContent: "coverage/\n*.tmp\n!keep.tmp\n",
      customExcludes: ["custom-build/"]
    });

    expect(matcher.isIgnored("node_modules/react/index.js", false)).toBe(true);
    expect(matcher.isIgnored(".git/HEAD", false)).toBe(true);
    expect(matcher.isIgnored("custom-build/out.js", false)).toBe(true);
    expect(matcher.isIgnored("notes.tmp", false)).toBe(true);
    expect(matcher.isIgnored("keep.tmp", false)).toBe(false);
    expect(matcher.isIgnored("src/app.ts", false)).toBe(false);

    expect(matcher.isSecretFile(".env")).toBe(true);
    expect(matcher.isSecretFile(".env.production")).toBe(true);
    expect(matcher.isSecretFile("certs/private.pem")).toBe(true);
    expect(matcher.isSecretFile("src/index.ts")).toBe(false);
  });

  it("detects Git repository status (branch and clean vs modified) and non-Git folders", async () => {
    const nonGit = await detectGitStatus(workspaceDir);
    expect(nonGit.isGitRepo).toBe(false);

    // Initialize a temporary git repo
    execFileSync("git", ["init", "-b", "main"], { cwd: workspaceDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@codemind.local"], {
      cwd: workspaceDir,
      stdio: "ignore"
    });
    execFileSync("git", ["config", "user.name", "CodeMind Test"], {
      cwd: workspaceDir,
      stdio: "ignore"
    });
    execFileSync("git", ["add", "src/index.ts"], { cwd: workspaceDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: workspaceDir, stdio: "ignore" });

    const dirtyStatus = await detectGitStatus(workspaceDir);
    expect(dirtyStatus.isGitRepo).toBe(true);
    expect(dirtyStatus.branch).toBe("main");
    expect(dirtyStatus.isDirty).toBe(true);
    expect(dirtyStatus.modifiedCount).toBeGreaterThan(0);
  });

  it("indexes workspace through engine IPC, searches symbols, and incrementally updates on file save", async () => {
    // Unauthorized workspace rejected by engine IPC
    const unauthIndex = await ipcMain.invoke(IPC_CHANNELS.ENGINE_INDEX_WORKSPACE, {
      workspaceRoot: outsideDir
    });
    expect(unauthIndex.ok).toBe(false);

    const openRes = await ipcMain.invoke<{ rootPath: string }>(IPC_CHANNELS.WORKSPACE_OPEN, {
      rootPath: workspaceDir
    });
    const rootPath = openRes.ok ? openRes.data.rootPath : workspaceDir;

    const indexRes = await ipcMain.invoke<{ indexedFiles: number; totalSymbols: number }>(
      IPC_CHANNELS.ENGINE_INDEX_WORKSPACE,
      { workspaceRoot: rootPath }
    );
    expect(indexRes.ok).toBe(true);
    if (indexRes.ok) {
      expect(indexRes.data.indexedFiles).toBeGreaterThanOrEqual(2);
      expect(indexRes.data.totalSymbols).toBeGreaterThanOrEqual(2);
    }

    const symRes = await ipcMain.invoke<{ symbol: { name: string; filePath: string } }[]>(
      IPC_CHANNELS.ENGINE_SEARCH_SYMBOLS,
      { workspaceRoot: rootPath, query: "Header" }
    );
    expect(symRes.ok).toBe(true);
    if (symRes.ok) {
      expect(symRes.data[0]?.symbol.name).toBe("Header");
      expect(symRes.data[0]?.symbol.filePath).toBe("src/components/Header.tsx");
    }

    // Save a modified file via FILE_WRITE and confirm incremental index updates automatically
    const readRes = await ipcMain.invoke<FileReadResult>(IPC_CHANNELS.FILE_READ, {
      workspaceRoot: rootPath,
      relativePath: "src/index.ts"
    });
    expect(readRes.ok).toBe(true);
    if (!readRes.ok) return;

    await ipcMain.invoke(IPC_CHANNELS.FILE_WRITE, {
      workspaceRoot: rootPath,
      relativePath: "src/index.ts",
      content: 'export const greeting = "hello";\nexport function freshlyAddedFn() { return 1; }\n',
      expectedContentHash: readRes.data.contentHash
    });

    const updatedSymRes = await ipcMain.invoke<{ symbol: { name: string } }[]>(
      IPC_CHANNELS.ENGINE_SEARCH_SYMBOLS,
      { workspaceRoot: rootPath, query: "freshlyAddedFn" }
    );
    expect(updatedSymRes.ok).toBe(true);
    if (updatedSymRes.ok) {
      expect(updatedSymRes.data.map((r) => r.symbol.name)).toContain("freshlyAddedFn");
    }
  });
});
