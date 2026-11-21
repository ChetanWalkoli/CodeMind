// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, AIRequest, AIResponse } from "@codemind/ai-core";
import {
  IPC_CHANNELS,
  type AIContextApprovalRecord,
  type AIContextSnapshot,
  type AIExecuteApprovedResult,
  type IpcResponse
} from "@codemind/shared";
import { ContextApprovalStore } from "../ai/contextApprovalStore.js";
import { CredentialStore, type SafeStorageAdapter } from "../ai/credentialStore.js";
import { AIProviderManager } from "../ai/providerManager.js";
import { registerIpcHandlers, unregisterIpcHandlers, type IpcMainLike } from "../ipc/index.js";
import { PreferencesStore } from "../utils/preferences.js";
import { WorkspaceAuthority, WorkspaceSecurityError } from "../workspace/pathSecurity.js";

function createTestSafeStorage(): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, "utf8"),
    decryptString: (buf: Buffer) => buf.toString("utf8")
  };
}

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

describe("Milestone 5.4 — Secure Transmission Gate & Budgeted Provider Execution", () => {
  let workspaceDir: string;
  let outsideDir: string;
  let prefsDir: string;
  let ipcMain: MockIpcMain;
  let authority: WorkspaceAuthority;
  let approvalStore: ContextApprovalStore;
  let generateSpy: ReturnType<typeof vi.fn<(input: AIRequest) => Promise<AIResponse>>>;

  function setupHarness(approvalTtlMs = 30 * 60 * 1000) {
    unregisterIpcHandlers(ipcMain);
    approvalStore = new ContextApprovalStore(approvalTtlMs);
    const preferences = new PreferencesStore(prefsDir);
    const credentials = new CredentialStore(prefsDir, createTestSafeStorage());
    credentials.setApiKey("gemini", "AIzaSyTestKey1234567890abcdefghij");

    generateSpy = vi.fn<(input: AIRequest) => Promise<AIResponse>>().mockResolvedValue({
      content: "Verified explanation grounded in src/auth.ts.",
      model: "gemini-3.8-flash",
      provider: "gemini",
      finishReason: "STOP",
      usage: { inputTokens: 120, outputTokens: 24, totalTokens: 144 }
    });

    const providerManager = new AIProviderManager(credentials, () => {
      return {
        id: "gemini",
        name: "Google Gemini",
        defaultModel: "gemini-3.8-flash",
        generate: generateSpy,
        stream: vi.fn()
      } as unknown as AIProvider;
    });

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
      credentials,
      providerManager,
      approvalStore
    });
  }

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-gate-ws-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-gate-outside-"));
    prefsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-gate-prefs-"));
    ipcMain = new MockIpcMain();
    authority = new WorkspaceAuthority();

    fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "src", "auth.ts"),
      "export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(workspaceDir, "src", "leaky.ts"),
      'export const leaked = "AIzaSy1234567890abcdefghij1234567890";\n',
      "utf8"
    );
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "outside-secret-data", "utf8");

    authority.authorizeRoot(workspaceDir);
    setupHarness();
  });

  afterEach(() => {
    unregisterIpcHandlers(ipcMain);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(prefsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("blocks provider calls when approval is missing or revoked", async () => {
    const buildRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "Explain verifyToken",
      activeFilePath: "src/auth.ts"
    });
    expect(buildRes.ok).toBe(true);
    if (!buildRes.ok) return;

    // 1. Missing approval -> blocked before provider is ever invoked
    const unapprovedExec = await ipcMain.invoke<AIExecuteApprovedResult>(
      IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: buildRes.data.snapshotId
      }
    );
    expect(unapprovedExec.ok).toBe(false);
    if (!unapprovedExec.ok) {
      expect(unapprovedExec.error.code).toBe("CONTEXT_NOT_APPROVED");
    }
    expect(generateSpy).not.toHaveBeenCalled();

    // 2. Approve then revoke -> still blocked
    await ipcMain.invoke<AIContextApprovalRecord>(IPC_CHANNELS.AI_APPROVE_CONTEXT, {
      workspaceRoot: workspaceDir,
      snapshotId: buildRes.data.snapshotId,
      approved: true
    });
    await ipcMain.invoke<AIContextApprovalRecord>(IPC_CHANNELS.AI_APPROVE_CONTEXT, {
      workspaceRoot: workspaceDir,
      snapshotId: buildRes.data.snapshotId,
      approved: false
    });

    const revokedExec = await ipcMain.invoke<AIExecuteApprovedResult>(
      IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: buildRes.data.snapshotId
      }
    );
    expect(revokedExec.ok).toBe(false);
    if (!revokedExec.ok) {
      expect(revokedExec.error.code).toBe("CONTEXT_NOT_APPROVED");
    }
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("blocks provider calls when approval has expired", async () => {
    setupHarness(15); // 15ms TTL

    const buildRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "Explain verifyToken",
      activeFilePath: "src/auth.ts"
    });
    expect(buildRes.ok).toBe(true);
    if (!buildRes.ok) return;

    await ipcMain.invoke<AIContextApprovalRecord>(IPC_CHANNELS.AI_APPROVE_CONTEXT, {
      workspaceRoot: workspaceDir,
      snapshotId: buildRes.data.snapshotId,
      approved: true
    });

    await new Promise((resolve) => setTimeout(resolve, 35));

    const expiredExec = await ipcMain.invoke<AIExecuteApprovedResult>(
      IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: buildRes.data.snapshotId
      }
    );
    expect(expiredExec.ok).toBe(false);
    if (!expiredExec.ok) {
      expect(expiredExec.error.code).toBe("CONTEXT_APPROVAL_EXPIRED");
    }
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("blocks transmission and revokes approval when a file is edited externally outside CodeMind", async () => {
    const buildRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "Explain verifyToken",
      activeFilePath: "src/auth.ts"
    });
    expect(buildRes.ok).toBe(true);
    if (!buildRes.ok) return;

    await ipcMain.invoke<AIContextApprovalRecord>(IPC_CHANNELS.AI_APPROVE_CONTEXT, {
      workspaceRoot: workspaceDir,
      snapshotId: buildRes.data.snapshotId,
      approved: true
    });

    // External edit made outside CodeMind (bypasses FILE_WRITE IPC)
    fs.writeFileSync(
      path.join(workspaceDir, "src", "auth.ts"),
      "export function verifyToken(token: string): boolean {\n  return token === 'tampered';\n}\n",
      "utf8"
    );

    const execRes = await ipcMain.invoke<AIExecuteApprovedResult>(
      IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: buildRes.data.snapshotId
      }
    );
    expect(execRes.ok).toBe(false);
    if (!execRes.ok) {
      expect(execRes.error.code).toBe("CONTEXT_STALE_MODIFIED");
    }
    expect(generateSpy).not.toHaveBeenCalled();

    // Approval must now be revoked so a new preview & approval is required
    const statusAfter = await ipcMain.invoke<AIContextApprovalRecord>(
      IPC_CHANNELS.AI_GET_CONTEXT_APPROVAL,
      {
        workspaceRoot: workspaceDir,
        snapshotId: buildRes.data.snapshotId
      }
    );
    expect(statusAfter.ok).toBe(true);
    if (statusAfter.ok) {
      expect(statusAfter.data.approved).toBe(false);
    }
  });

  it("blocks symlink traversal attempts pointing outside the authorized workspace", async () => {
    const buildRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "Explain verifyToken",
      activeFilePath: "src/auth.ts"
    });
    expect(buildRes.ok).toBe(true);
    if (!buildRes.ok) return;

    await ipcMain.invoke<AIContextApprovalRecord>(IPC_CHANNELS.AI_APPROVE_CONTEXT, {
      workspaceRoot: workspaceDir,
      snapshotId: buildRes.data.snapshotId,
      approved: true
    });

    // Attempt real symlink replacement; fall back to mocking resolveSafePath symlink error if OS blocks unprivileged symlinks
    const authPath = path.join(workspaceDir, "src", "auth.ts");
    let createdRealSymlink = false;
    try {
      fs.unlinkSync(authPath);
      fs.symlinkSync(path.join(outsideDir, "secret.txt"), authPath);
      createdRealSymlink = true;
    } catch {
      // Restore file and simulate symlink escape rejection from WorkspaceAuthority
      fs.writeFileSync(
        authPath,
        "export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n",
        "utf8"
      );
      vi.spyOn(authority, "resolveSafePath").mockImplementation(() => {
        throw new WorkspaceSecurityError(
          "PATH_TRAVERSAL_BLOCKED",
          "Symlink target resolves outside the authorized workspace."
        );
      });
    }

    const execRes = await ipcMain.invoke<AIExecuteApprovedResult>(
      IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: buildRes.data.snapshotId
      }
    );
    expect(execRes.ok).toBe(false);
    if (!execRes.ok) {
      expect(execRes.error.code).toBe("CONTEXT_PATH_SECURITY_VIOLATION");
    }
    expect(generateSpy).not.toHaveBeenCalled();
    void createdRealSymlink;
  });

  it("excludes inline secrets during preview and blocks them at the transmission gate", async () => {
    // 1. Preview excludes src/leaky.ts with reason "inline-secret"
    const buildRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "Explain leaky config",
      explicitFilePaths: ["src/leaky.ts", "src/auth.ts"],
      includeDependencies: false
    });
    expect(buildRes.ok).toBe(true);
    if (!buildRes.ok) return;

    expect(buildRes.data.items.map((i) => i.filePath)).toEqual(["src/auth.ts"]);
    expect(buildRes.data.excluded).toEqual(
      expect.arrayContaining([{ filePath: "src/leaky.ts", reason: "inline-secret" }])
    );

    // 2. Defense-in-depth: even if a snapshot containing src/leaky.ts were registered & approved,
    // the transmission gate re-scans and blocks it before calling the provider.
    const realRoot = authority.getAuthorizedRoot(workspaceDir);
    const leakyRaw = fs.readFileSync(path.join(workspaceDir, "src", "leaky.ts"));
    const leakyHash = crypto.createHash("sha256").update(leakyRaw).digest("hex");

    const syntheticSnapshot: AIContextSnapshot = {
      ...buildRes.data,
      snapshotId: "synthetic-leaky-snapshot",
      workspaceRoot: realRoot,
      items: [
        {
          id: "src/leaky.ts:1-1",
          filePath: "src/leaky.ts",
          language: "typescript",
          contentHash: leakyHash,
          startLine: 1,
          endLine: 1,
          symbols: ["leaked"],
          reasons: ["explicit-file"],
          relevanceScore: 90,
          byteLength: leakyRaw.length,
          estimatedTokens: 16,
          truncated: false,
          content: leakyRaw.toString("utf8")
        }
      ]
    };
    approvalStore.registerSnapshot(syntheticSnapshot);
    approvalStore.setApproval(realRoot, syntheticSnapshot.snapshotId, true);

    const execRes = await ipcMain.invoke<AIExecuteApprovedResult>(
      IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: syntheticSnapshot.snapshotId
      }
    );
    expect(execRes.ok).toBe(false);
    if (!execRes.ok) {
      expect(execRes.error.code).toBe("INLINE_SECRET_DETECTED");
      expect(execRes.error.message).not.toContain("AIzaSy1234567890");
    }
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("transmits budgeted messages through the provider ONLY after full validation succeeds", async () => {
    const buildRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "Explain verifyToken",
      activeFilePath: "src/auth.ts"
    });
    expect(buildRes.ok).toBe(true);
    if (!buildRes.ok) return;

    await ipcMain.invoke<AIContextApprovalRecord>(IPC_CHANNELS.AI_APPROVE_CONTEXT, {
      workspaceRoot: workspaceDir,
      snapshotId: buildRes.data.snapshotId,
      approved: true
    });

    const execRes = await ipcMain.invoke<AIExecuteApprovedResult>(
      IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: buildRes.data.snapshotId,
        maxOutputTokens: 2048
      }
    );

    expect(execRes.ok).toBe(true);
    expect(generateSpy).toHaveBeenCalledTimes(1);

    const callArg = generateSpy.mock.calls[0]?.[0];
    expect(callArg?.model).toBe("gemini-3.8-flash");
    expect(callArg?.maxTokens).toBe(2048);
    expect(callArg?.messages).toHaveLength(2);
    expect(callArg?.messages[1]?.content).toContain("<untrusted_repository_context>");
    expect(callArg?.messages[1]?.content).toContain("src/auth.ts");

    if (execRes.ok) {
      expect(execRes.data.snapshotId).toBe(buildRes.data.snapshotId);
      expect(execRes.data.content).toContain("Verified explanation");
      expect(execRes.data.budget.modelId).toBe("gemini-3.8-flash");
      expect(execRes.data.budget.reservedOutputTokens).toBe(2048);
      expect(execRes.data.budget.isExactEstimate).toBe(false);
    }
  });

  it("rejects transmission and revokes approval if final model budgeting omits or truncates approved context", async () => {
    // Create a snapshot with an item whose declared range exceeds Gemini's 1M context window
    // by using a large ~3.5MB payload (or 42,000 lines) — instead, test via a 40,000-line file (~960k tokens)
    // that overflows when maxOutputTokens=32768 (10% safety margin leaves ~910k maxInputTokens)
    const largeLines = Array.from(
      { length: 42_000 },
      (_, i) => `export const value_${i} = ${i} + ${i + 1}; // deterministic payload line ${i}`
    ).join("\n");
    const largePath = path.join(workspaceDir, "src", "largeModule.ts");
    fs.writeFileSync(largePath, largeLines, "utf8");

    const realRoot = authority.getAuthorizedRoot(workspaceDir);
    const largeRaw = fs.readFileSync(largePath);
    const largeHash = crypto.createHash("sha256").update(largeRaw).digest("hex");

    const approvedSnapshot: AIContextSnapshot = {
      snapshotId: "approved-large-snapshot",
      workspaceRoot: realRoot,
      taskType: "code-qa",
      templateId: "codemind.code-qa",
      templateVersion: "1.0.0",
      query: "Summarize largeModule",
      items: [
        {
          id: "src/largeModule.ts:1-42000",
          filePath: "src/largeModule.ts",
          language: "typescript",
          contentHash: largeHash,
          startLine: 1,
          endLine: 42_000,
          symbols: ["value_0"],
          reasons: ["explicit-file"],
          relevanceScore: 90,
          byteLength: largeRaw.length,
          estimatedTokens: 960_000,
          truncated: false,
          content: largeLines
        }
      ],
      excluded: [],
      totalBytes: largeRaw.length,
      estimatedTokens: 960_000,
      budgetBytes: largeRaw.length,
      createdAt: "2026-11-22T00:00:00.000Z"
    };

    approvalStore.registerSnapshot(approvedSnapshot);
    approvalStore.setApproval(realRoot, approvedSnapshot.snapshotId, true);

    const execRes = await ipcMain.invoke<AIExecuteApprovedResult>(
      IPC_CHANNELS.AI_EXECUTE_APPROVED_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: approvedSnapshot.snapshotId,
        model: "gemini-3.8-flash",
        maxOutputTokens: 32_768
      }
    );

    expect(execRes.ok).toBe(false);
    if (!execRes.ok) {
      expect(execRes.error.code).toBe("CONTEXT_BUDGET_CHANGED");
    }
    expect(generateSpy).not.toHaveBeenCalled();

    // Approval must be revoked so user must rebuild & re-approve the updated preview
    const statusAfter = await ipcMain.invoke<AIContextApprovalRecord>(
      IPC_CHANNELS.AI_GET_CONTEXT_APPROVAL,
      {
        workspaceRoot: workspaceDir,
        snapshotId: approvedSnapshot.snapshotId
      }
    );
    expect(statusAfter.ok).toBe(true);
    if (statusAfter.ok) {
      expect(statusAfter.data.approved).toBe(false);
    }
  });
});
