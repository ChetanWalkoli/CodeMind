// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIProviderError,
  type AIProvider,
  type AIRequest,
  type AIStreamEvent
} from "@codemind/ai-core";
import {
  IPC_CHANNELS,
  type AIContextApprovalRecord,
  type AIContextSnapshot,
  type AIStreamCancelResponse,
  type AIStreamIpcEvent,
  type AIStreamStartResponse,
  type AIUsageSummary,
  type ConversationPage,
  type ConversationSummary,
  type IpcResponse
} from "@codemind/shared";
import { ContextApprovalStore } from "../ai/contextApprovalStore.js";
import { ConversationStore } from "../ai/conversationStore.js";
import { CredentialStore, type SafeStorageAdapter } from "../ai/credentialStore.js";
import { AIProviderManager } from "../ai/providerManager.js";
import { AIUsageStore } from "../ai/usageStore.js";
import { registerIpcHandlers, unregisterIpcHandlers, type IpcMainLike } from "../ipc/index.js";
import { PreferencesStore } from "../utils/preferences.js";
import { WorkspaceAuthority } from "../workspace/pathSecurity.js";

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

async function waitForCondition(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for stream condition");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("Milestones 5.6, 5.7 & 5.8 — Streaming, Cancellation, Conversations & Usage", () => {
  let workspaceDir: string;
  let dataDir: string;
  let ipcMain: MockIpcMain;
  let authority: WorkspaceAuthority;
  let emittedEvents: AIStreamIpcEvent[];
  let streamImpl: (input: AIRequest) => AsyncIterable<AIStreamEvent>;
  let conversationStore: ConversationStore;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-m56-ws-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-m56-data-"));
    ipcMain = new MockIpcMain();
    authority = new WorkspaceAuthority();
    emittedEvents = [];

    fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, "src", "auth.ts"),
      "export function verifyToken(token: string): boolean {\n  return token.length > 0;\n}\n",
      "utf8"
    );

    authority.authorizeRoot(workspaceDir);

    const preferences = new PreferencesStore(dataDir);
    const credentials = new CredentialStore(dataDir, createTestSafeStorage());
    credentials.setApiKey("gemini", "AIzaSyStreamSecretKey1234567890ABCD");
    conversationStore = new ConversationStore(dataDir);

    streamImpl = async function* () {
      yield { type: "delta", text: "Hello " };
      yield { type: "delta", text: "CodeMind!" };
      yield { type: "usage", usage: { inputTokens: 150, outputTokens: 20, totalTokens: 170 } };
      yield {
        type: "done",
        response: {
          content: "Hello CodeMind!",
          model: "gemini-3.8-flash",
          provider: "gemini",
          usage: { inputTokens: 150, outputTokens: 20, totalTokens: 170 }
        }
      };
    };

    const providerManager = new AIProviderManager(credentials, () => {
      return {
        id: "gemini",
        name: "Google Gemini",
        defaultModel: "gemini-3.8-flash",
        generate: vi.fn(),
        stream: (input: AIRequest) => streamImpl(input)
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
      approvalStore: new ContextApprovalStore(),
      conversationStore,
      usageStore: new AIUsageStore(dataDir),
      streamEventEmitter: (evt) => emittedEvents.push(evt)
    });
  });

  afterEach(() => {
    unregisterIpcHandlers(ipcMain);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function buildAndApproveSnapshot(): Promise<AIContextSnapshot> {
    const buildRes = await ipcMain.invoke<AIContextSnapshot>(IPC_CHANNELS.AI_BUILD_CONTEXT, {
      workspaceRoot: workspaceDir,
      taskType: "code-qa",
      query: "Explain verifyToken",
      activeFilePath: "src/auth.ts"
    });
    if (!buildRes.ok) throw new Error(buildRes.error.message);

    const approveRes = await ipcMain.invoke<AIContextApprovalRecord>(
      IPC_CHANNELS.AI_APPROVE_CONTEXT,
      {
        workspaceRoot: workspaceDir,
        snapshotId: buildRes.data.snapshotId,
        approved: true
      }
    );
    if (!approveRes.ok) throw new Error(approveRes.error.message);
    return buildRes.data;
  }

  it("streams ordered events isolated by requestId, persists conversation messages, and records usage", async () => {
    const convRes = await ipcMain.invoke<ConversationSummary>(IPC_CHANNELS.AI_CONVERSATION_CREATE, {
      workspaceRoot: workspaceDir,
      title: "Auth Investigation",
      taskType: "code-qa"
    });
    expect(convRes.ok).toBe(true);
    if (!convRes.ok) return;

    const snapshot = await buildAndApproveSnapshot();

    const startRes = await ipcMain.invoke<AIStreamStartResponse>(IPC_CHANNELS.AI_STREAM_START, {
      requestId: "req-stream-1",
      workspaceRoot: workspaceDir,
      snapshotId: snapshot.snapshotId,
      conversationId: convRes.data.id
    });
    expect(startRes.ok).toBe(true);

    await waitForCondition(() =>
      emittedEvents.some((e) => e.requestId === "req-stream-1" && e.type === "stream:complete")
    );

    const types = emittedEvents.filter((e) => e.requestId === "req-stream-1").map((e) => e.type);
    expect(types).toEqual([
      "stream:start",
      "stream:delta",
      "stream:delta",
      "stream:usage",
      "stream:complete"
    ]);

    // Conversation persisted both user & assistant messages without storing API keys
    const pageRes = await ipcMain.invoke<ConversationPage>(IPC_CHANNELS.AI_CONVERSATION_GET, {
      workspaceRoot: workspaceDir,
      conversationId: convRes.data.id,
      limit: 10
    });
    expect(pageRes.ok).toBe(true);
    if (pageRes.ok) {
      expect(pageRes.data.messages).toHaveLength(2);
      expect(pageRes.data.messages[0]?.role).toBe("user");
      expect(pageRes.data.messages[1]?.content).toBe("Hello CodeMind!");
    }

    const convFileRaw = fs.readFileSync(path.join(dataDir, "ai-conversations.json"), "utf8");
    expect(convFileRaw).not.toContain("AIzaSyStreamSecretKey");

    // Usage summary reflects provider-reported tokens & never fabricates Gemini cost
    const usageRes = await ipcMain.invoke<AIUsageSummary>(IPC_CHANNELS.AI_GET_USAGE);
    expect(usageRes.ok).toBe(true);
    if (usageRes.ok) {
      expect(usageRes.data.totalRequests).toBe(1);
      expect(usageRes.data.succeededRequests).toBe(1);
      expect(usageRes.data.providerReportedInputTokens).toBe(150);
      expect(usageRes.data.providerReportedOutputTokens).toBe(20);
      expect(usageRes.data.estimatedCostUsd).toBeNull();
    }
  });

  it("cancels active streams on renderer request and on credential changes", async () => {
    const snapshot = await buildAndApproveSnapshot();

    // Hanging stream that respects AbortSignal
    streamImpl = async function* (input: AIRequest) {
      yield { type: "delta", text: "Partial..." };
      await new Promise<void>((resolve) => {
        input.signal?.addEventListener("abort", () => resolve());
      });
    };

    // 1. Renderer-initiated cancellation
    await ipcMain.invoke<AIStreamStartResponse>(IPC_CHANNELS.AI_STREAM_START, {
      requestId: "req-cancel-1",
      workspaceRoot: workspaceDir,
      snapshotId: snapshot.snapshotId
    });
    await waitForCondition(() =>
      emittedEvents.some((e) => e.requestId === "req-cancel-1" && e.type === "stream:delta")
    );

    const cancelRes = await ipcMain.invoke<AIStreamCancelResponse>(IPC_CHANNELS.AI_STREAM_CANCEL, {
      requestId: "req-cancel-1"
    });
    expect(cancelRes.ok).toBe(true);
    if (cancelRes.ok) expect(cancelRes.data.cancelled).toBe(true);

    await waitForCondition(() =>
      emittedEvents.some((e) => e.requestId === "req-cancel-1" && e.type === "stream:cancelled")
    );

    // 2. Credential change cancels active streams for that provider
    await ipcMain.invoke<AIStreamStartResponse>(IPC_CHANNELS.AI_STREAM_START, {
      requestId: "req-cred-cancel",
      workspaceRoot: workspaceDir,
      snapshotId: snapshot.snapshotId
    });
    await waitForCondition(() =>
      emittedEvents.some((e) => e.requestId === "req-cred-cancel" && e.type === "stream:delta")
    );

    await ipcMain.invoke(IPC_CHANNELS.AI_CLEAR_KEY, { provider: "gemini" });

    await waitForCondition(() =>
      emittedEvents.some((e) => e.requestId === "req-cred-cancel" && e.type === "stream:cancelled")
    );
  });

  it("validates structured streaming responses on completion and rejects fabricated references", async () => {
    const snapshot = await buildAndApproveSnapshot();

    // Structured stream with a fabricated file path -> must emit stream:error, NEVER stream:complete
    streamImpl = async function* () {
      yield {
        type: "delta",
        text: JSON.stringify({
          summary: "Bad ref",
          explanation: ["Test"],
          references: [{ filePath: "src/nonexistent.ts", startLine: 1, endLine: 2 }],
          confidence: "low",
          limitations: []
        })
      };
    };

    await ipcMain.invoke<AIStreamStartResponse>(IPC_CHANNELS.AI_STREAM_START, {
      requestId: "req-struct-bad",
      workspaceRoot: workspaceDir,
      snapshotId: snapshot.snapshotId,
      structured: true
    });

    await waitForCondition(() =>
      emittedEvents.some((e) => e.requestId === "req-struct-bad" && e.type === "stream:error")
    );

    const badEvents = emittedEvents.filter((e) => e.requestId === "req-struct-bad");
    expect(badEvents.some((e) => e.type === "stream:delta")).toBe(false);
    expect(badEvents.some((e) => e.type === "stream:complete")).toBe(false);
  });

  it("supports conversation CRUD and paginated chronological message loading", async () => {
    const createRes = await ipcMain.invoke<ConversationSummary>(
      IPC_CHANNELS.AI_CONVERSATION_CREATE,
      { workspaceRoot: workspaceDir, title: "Initial Title", taskType: "code-qa" }
    );
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const convId = createRes.data.id;

    // Append 5 messages to test pagination (limit=2)
    const realRoot = authority.getAuthorizedRoot(workspaceDir);
    for (let i = 1; i <= 5; i += 1) {
      conversationStore.appendMessage(realRoot, convId, {
        role: i % 2 === 1 ? "user" : "assistant",
        content: `Message ${i}`,
        status: "completed",
        references: []
      });
    }

    const page1 = await ipcMain.invoke<ConversationPage>(IPC_CHANNELS.AI_CONVERSATION_GET, {
      workspaceRoot: workspaceDir,
      conversationId: convId,
      limit: 2
    });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.data.messages.map((m) => m.content)).toEqual(["Message 4", "Message 5"]);
    expect(page1.data.hasMore).toBe(true);
    expect(page1.data.nextCursor).toBe(3);

    const page2 = await ipcMain.invoke<ConversationPage>(IPC_CHANNELS.AI_CONVERSATION_GET, {
      workspaceRoot: workspaceDir,
      conversationId: convId,
      limit: 2,
      cursor: page1.data.nextCursor!
    });
    expect(page2.ok).toBe(true);
    if (page2.ok) {
      expect(page2.data.messages.map((m) => m.content)).toEqual(["Message 2", "Message 3"]);
    }

    // Rename & Delete
    const renameRes = await ipcMain.invoke<ConversationSummary>(
      IPC_CHANNELS.AI_CONVERSATION_RENAME,
      { workspaceRoot: workspaceDir, conversationId: convId, title: "Renamed Thread" }
    );
    expect(renameRes.ok).toBe(true);
    if (renameRes.ok) expect(renameRes.data.title).toBe("Renamed Thread");

    const delRes = await ipcMain.invoke<{ deleted: boolean }>(IPC_CHANNELS.AI_CONVERSATION_DELETE, {
      workspaceRoot: workspaceDir,
      conversationId: convId
    });
    expect(delRes.ok).toBe(true);
    if (delRes.ok) expect(delRes.data.deleted).toBe(true);
  });

  it("reports partialContentReceived and timeoutCategory on mid-stream idle timeout with privacy-safe diagnostics", async () => {
    const snapshot = await buildAndApproveSnapshot();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    streamImpl = async function* () {
      yield { type: "delta", text: "Verified partial answer..." };
      throw new AIProviderError(
        "TIMEOUT",
        "The response stream became inactive for 25s and was interrupted.",
        {
          provider: "gemini",
          retryable: false,
          timeoutCategory: "stream-idle",
          retryCount: 0
        }
      );
    };

    await ipcMain.invoke<AIStreamStartResponse>(IPC_CHANNELS.AI_STREAM_START, {
      requestId: "req-partial-idle",
      workspaceRoot: workspaceDir,
      snapshotId: snapshot.snapshotId
    });

    await waitForCondition(() =>
      emittedEvents.some((e) => e.requestId === "req-partial-idle" && e.type === "stream:error")
    );

    const errEvt = emittedEvents.find(
      (e) => e.requestId === "req-partial-idle" && e.type === "stream:error"
    );
    expect(errEvt).toBeDefined();
    if (errEvt && errEvt.type === "stream:error") {
      expect(errEvt.code).toBe("TIMEOUT");
      expect(errEvt.timeoutCategory).toBe("stream-idle");
      expect(errEvt.partialContentReceived).toBe(true);
    }

    // Verify structured diagnostic log contains required telemetry and NO sensitive content
    const diagCall = warnSpy.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("[CodeMind AI Stream]")
    );
    expect(diagCall).toBeDefined();
    const serialized = String(diagCall?.[1] ?? "");
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.requestId).toBe("req-partial-idle");
    expect(parsed.timeoutCategory).toBe("stream-idle");
    expect(parsed.partialResponseReceived).toBe(true);
    expect(parsed.errorCode).toBe("TIMEOUT");
    expect(typeof parsed.contextPrepDurationMs).toBe("number");
    expect(typeof parsed.timeToFirstEventMs).toBe("number");
    expect(typeof parsed.totalElapsedMs).toBe("number");
    expect(serialized).not.toContain("AIza");
    expect(serialized).not.toContain("Verified partial answer");

    warnSpy.mockRestore();
  });
});
