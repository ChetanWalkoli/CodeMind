// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IPC_CHANNELS,
  type AIContextApprovalRecord,
  type AIContextSnapshot,
  type FileWriteResult,
  type IpcResponse
} from "@codemind/shared";
import { ContextApprovalError, ContextApprovalStore } from "../ai/contextApprovalStore.js";
import { registerIpcHandlers, unregisterIpcHandlers, type IpcMainLike } from "../ipc/index.js";
import { PreferencesStore } from "../utils/preferences.js";
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
      throw new Error(`No handler registered for ${channel}`);
    }
    return (await handler({}, payload)) as IpcResponse<T>;
  }
}

describe("Milestone 5.3 — Context Builder, Secret Exclusion & Snapshot Approval", () => {
  let workspaceDir: string;
  let prefsDir: string;
  let ipcMain: MockIpcMain;
  let authority: WorkspaceAuthority;
  let approvalStore: ContextApprovalStore;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-ctx-ws-"));
    prefsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-ctx-prefs-"));
    ipcMain = new MockIpcMain();
    authority = new WorkspaceAuthority();
    approvalStore = new ContextApprovalStore();

    fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "ignored"), { recursive: true });

    fs.writeFileSync(path.join(workspaceDir, ".gitignore"), "ignored/\n", "utf8");
    fs.writeFileSync(
      path.join(workspaceDir, ".env"),
      "GEMINI_API_KEY=AIzaSyTopSecret1234567890ABCDEF\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceDir, "secrets.json"),
      JSON.stringify({ secretToken: "super-secret-value" }),
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceDir, "ignored", "debug.ts"),
      "export const debugSecret = true;\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceDir, "src", "tokenStore.ts"),
      "export function readToken(id: string): string {\n  return id.trim();\n}\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceDir, "src", "auth.ts"),
      'import { readToken } from "./tokenStore";\nexport function verifyToken(id: string): boolean {\n  return readToken(id).length > 0;\n}\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceDir, "src", "login.ts"),
      'import { verifyToken } from "./auth";\nexport function handleLogin(id: string): boolean {\n  return verifyToken(id);\n}\n',
      "utf8"
    );

    const preferences = new PreferencesStore(prefsDir);
    authority.authorizeRoot(workspaceDir);

    registerIpcHandlers(ipcMain, {
      metadata: {
        name: "CodeMind",
        version: "0.1.0",
        platform: "win32",
        arch: "x64",
        electronVersion: "45.4.1",
        nodeVersion: "24.0.0",
        chromeVersion: "156.0.0"
      },
      preferences,
      authority,
      approvalStore
    });
  });

  afterEach(() => {
    unregisterIpcHandlers(ipcMain);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(prefsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("retrieves relevant files deterministically with dependency awareness and never calls fetch/AI", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const resA = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "How does verifyToken work?",
      activeFilePath: "src/auth.ts",
      includeDependencies: true
    });

    const resB = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "How does verifyToken work?",
      activeFilePath: "src/auth.ts",
      includeDependencies: true
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
    if (!resA.ok || !resB.ok) return;

    expect(resA.data.snapshotId).toBe(resB.data.snapshotId);
    expect(resA.data.templateId).toBe("codemind.code-qa");
    expect(resA.data.templateVersion).toBe("1.0.0");

    const paths = resA.data.items.map((item) => item.filePath);
    expect(paths[0]).toBe("src/auth.ts");
    expect(paths).toContain("src/tokenStore.ts");
    expect(paths).toContain("src/login.ts");

    const tokenStoreItem = resA.data.items.find((i) => i.filePath === "src/tokenStore.ts");
    const loginItem = resA.data.items.find((i) => i.filePath === "src/login.ts");
    expect(tokenStoreItem?.reasons).toContain("dependency");
    expect(loginItem?.reasons).toContain("dependent");
  });

  it("strictly excludes secret, sensitive, ignored, and traversal paths even when explicitly requested", async () => {
    const res = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "Explain auth config",
      activeFilePath: ".env",
      explicitFilePaths: ["secrets.json", "ignored/debug.ts", "../outside.txt", "src/auth.ts"],
      includeDependencies: false
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const includedPaths = res.data.items.map((i) => i.filePath);
    expect(includedPaths).toEqual(["src/auth.ts"]);

    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toContain("AIzaSyTopSecret");
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("debugSecret");

    expect(res.data.excluded).toEqual(
      expect.arrayContaining([
        { filePath: ".env", reason: "secret-file" },
        { filePath: "secrets.json", reason: "secret-file" },
        { filePath: "ignored/debug.ts", reason: "ignored-path" },
        { filePath: "../outside.txt", reason: "outside-workspace" }
      ])
    );
  });

  it("binds explicit approval to exact snapshotId and invalidates approval when a file changes", async () => {
    const buildRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "explain-file",
      query: "Explain verifyToken",
      activeFilePath: "src/auth.ts"
    });
    expect(buildRes.ok).toBe(true);
    if (!buildRes.ok) return;

    const realRoot = authority.getAuthorizedRoot(workspaceDir);
    const snapshotV1 = buildRes.data;

    // Unapproved by default
    expect(() => approvalStore.assertApproved(realRoot, snapshotV1.snapshotId)).toThrow(
      ContextApprovalError
    );

    // Explicitly approve snapshot V1
    const approveRes = await ipcMain.invoke<AIContextApprovalRecord>(
      IPC_CHANNELS.AI_APPROVE_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: snapshotV1.snapshotId,
        approved: true
      }
    );
    expect(approveRes.ok).toBe(true);
    if (approveRes.ok) {
      expect(approveRes.data.approved).toBe(true);
    }
    expect(approvalStore.assertApproved(realRoot, snapshotV1.snapshotId).snapshotId).toBe(
      snapshotV1.snapshotId
    );

    // Saving a file included in the snapshot MUST invalidate approval
    const writeRes = await ipcMain.invoke<FileWriteResult>(IPC_CHANNELS.FILE_WRITE, {
      workspaceRoot: workspaceDir,
      relativePath: "src/auth.ts",
      content:
        'import { readToken } from "./tokenStore";\nexport function verifyToken(id: string): boolean {\n  return readToken(id).length > 3;\n}\n'
    });
    expect(writeRes.ok).toBe(true);

    // Old snapshot approval must now be revoked
    const statusAfterEdit = await ipcMain.invoke<AIContextApprovalRecord>(
      IPC_CHANNELS.AI_GET_CONTEXT_APPROVAL,
      {
        workspaceRoot: workspaceDir,
        snapshotId: snapshotV1.snapshotId
      }
    );
    expect(statusAfterEdit.ok).toBe(true);
    if (statusAfterEdit.ok) {
      expect(statusAfterEdit.data.approved).toBe(false);
    }
    expect(() => approvalStore.assertApproved(realRoot, snapshotV1.snapshotId)).toThrow(
      ContextApprovalError
    );

    // Rebuilding context produces a NEW snapshotId that is also unapproved
    const rebuildRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "explain-file",
      query: "Explain verifyToken",
      activeFilePath: "src/auth.ts"
    });
    expect(rebuildRes.ok).toBe(true);
    if (!rebuildRes.ok) return;
    expect(rebuildRes.data.snapshotId).not.toBe(snapshotV1.snapshotId);
    expect(() => approvalStore.assertApproved(realRoot, rebuildRes.data.snapshotId)).toThrow(
      ContextApprovalError
    );
  });

  it("rejects invalid context build payloads via Zod", async () => {
    const emptyQueryRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      query: "   "
    });
    expect(emptyQueryRes.ok).toBe(false);
    if (!emptyQueryRes.ok) {
      expect(emptyQueryRes.error.code).toBe("INVALID_PAYLOAD");
    }

    const hugeBudgetRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      query: "Explain auth",
      maxBytes: 10_000_000
    });
    expect(hugeBudgetRes.ok).toBe(false);
    if (!hugeBudgetRes.ok) {
      expect(hugeBudgetRes.error.code).toBe("INVALID_PAYLOAD");
    }
  });
});
