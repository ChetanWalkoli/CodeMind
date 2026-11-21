import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIContextSnapshot, CodeMindDesktopAPI } from "@codemind/shared";
import { useEditorStore } from "../../../stores/editor.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";
import { ContextPreviewPanel } from "../ContextPreviewPanel";

const SNAPSHOT_V1: AIContextSnapshot = {
  snapshotId: "aaaa1111222233334444555566667777",
  workspaceRoot: "C:\\projects\\demo",
  taskType: "code-qa",
  templateId: "codemind.code-qa",
  templateVersion: "1.0.0",
  query: "How does verifyToken work?",
  items: [
    {
      id: "src/auth.ts:1-4",
      filePath: "src/auth.ts",
      language: "typescript",
      contentHash: "hash-auth-1",
      startLine: 1,
      endLine: 4,
      symbols: ["verifyToken"],
      reasons: ["active-file", "symbol-match"],
      relevanceScore: 160,
      byteLength: 100,
      estimatedTokens: 25,
      truncated: false,
      content: "export function verifyToken() { return true; }"
    },
    {
      id: "src/tokenStore.ts:1-3",
      filePath: "src/tokenStore.ts",
      language: "typescript",
      contentHash: "hash-store-1",
      startLine: 1,
      endLine: 3,
      symbols: ["readToken"],
      reasons: ["dependency"],
      relevanceScore: 25,
      byteLength: 64,
      estimatedTokens: 16,
      truncated: true,
      content: "export function readToken() { return 'ok'; }"
    }
  ],
  excluded: [
    { filePath: ".env", reason: "secret-file" },
    { filePath: "src/lowPriority.ts", reason: "token-budget-exceeded" }
  ],
  totalBytes: 164,
  estimatedTokens: 41,
  budgetBytes: 32768,
  budget: {
    modelId: "gemini-3.8-flash",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    reservedOutputTokens: 4096,
    safetyMarginTokens: 104_858,
    maxInputTokens: 939_622,
    systemTokens: 140,
    userQueryTokens: 60,
    historyTokens: 0,
    availableContextTokens: 939_422,
    usedContextTokens: 85,
    totalEstimatedInputTokens: 285,
    estimatorId: "heuristic-code-v2",
    isExactEstimate: false
  },
  createdAt: "2026-11-22T00:00:00.000Z"
};

const SNAPSHOT_V2: AIContextSnapshot = {
  ...SNAPSHOT_V1,
  snapshotId: "bbbb9999888877776666555544443333",
  items: [SNAPSHOT_V1.items[0]!],
  excluded: [
    { filePath: ".env", reason: "secret-file" },
    { filePath: "src/tokenStore.ts", reason: "user-excluded" }
  ],
  totalBytes: 100,
  estimatedTokens: 25
};

describe("Milestone 5.3 — ContextPreviewPanel UI", () => {
  beforeEach(() => {
    useEditorStore.getState().resetToInitial();
    useWorkspaceStore.setState({
      workspace: { rootPath: "C:\\projects\\demo", name: "demo" }
    });
  });

  afterEach(() => {
    delete window.codemindDesktop;
    useWorkspaceStore.setState({ workspace: null });
  });

  it("builds a local context preview, requires explicit approval, and invalidates approval when context changes", async () => {
    const buildAIContext = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: SNAPSHOT_V1 })
      .mockResolvedValueOnce({ ok: true, data: SNAPSHOT_V2 });

    const approveAIContext = vi
      .fn()
      .mockImplementation(async (req: { snapshotId: string; approved: boolean }) => ({
        ok: true,
        data: {
          snapshotId: req.snapshotId,
          approved: req.approved,
          approvedAt: req.approved ? "2026-11-22T00:01:00.000Z" : null,
          expiresAt: req.approved ? "2026-11-22T00:31:00.000Z" : null
        }
      }));

    window.codemindDesktop = {
      buildAIContext,
      approveAIContext,
      getAIContextApproval: vi.fn(),
      listAIConversations: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      createAIConversation: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: "conv-1",
          workspaceRoot: "C:\\projects\\demo",
          title: "New Conversation",
          taskType: "code-qa",
          model: "gemini-3.8-flash",
          messageCount: 0,
          archived: false,
          createdAt: "2026-11-22T00:00:00.000Z",
          updatedAt: "2026-11-22T00:00:00.000Z"
        }
      }),
      getAIConversation: vi.fn(),
      deleteAIConversation: vi.fn(),
      startAIStream: vi.fn(),
      cancelAIStream: vi.fn(),
      onAIStreamEvent: vi.fn().mockReturnValue(() => undefined)
    } as unknown as CodeMindDesktopAPI;

    const user = userEvent.setup();
    render(<ContextPreviewPanel />);

    // Enter query and build local preview
    await user.type(screen.getByLabelText("Context query"), "How does verifyToken work?");
    await user.click(screen.getByRole("button", { name: /Build Context Preview/i }));

    await waitFor(() => {
      expect(screen.getByTestId("ai-context-snapshot")).toBeInTheDocument();
      expect(screen.getByTestId("ai-snapshot-id")).toHaveTextContent("aaaa11112222");
      expect(screen.getByTestId("ai-budget-model")).toHaveTextContent("gemini-3.8-flash");
      expect(screen.getByTestId("ai-budget-input")).toHaveTextContent("heuristic-code-v2");
      expect(screen.getByTestId("ai-budget-input")).toHaveTextContent("estimated");
      expect(screen.getByTestId("ai-budget-reservations")).toHaveTextContent("4,096 output");
      expect(screen.getByTestId("ai-approval-status")).toHaveTextContent(/Not Approved/i);
      expect(screen.getByTestId("ai-excluded-list")).toHaveTextContent(".env");
      expect(screen.getByTestId("ai-excluded-list")).toHaveTextContent("token-budget-exceeded");
      expect(screen.getByTestId("ai-context-snapshot")).toHaveTextContent("truncated");
    });

    // Explicitly approve snapshot V1
    await user.click(screen.getByRole("button", { name: /Approve Context Snapshot/i }));
    await waitFor(() => {
      expect(approveAIContext).toHaveBeenCalledWith({
        workspaceRoot: "C:\\projects\\demo",
        snapshotId: SNAPSHOT_V1.snapshotId,
        approved: true
      });
      expect(screen.getByTestId("ai-approval-status")).toHaveTextContent(/Approved/i);
    });

    // Exclude src/tokenStore.ts -> rebuilds snapshot V2 and MUST invalidate approval
    await user.click(screen.getByRole("button", { name: "Exclude src/tokenStore.ts" }));
    await waitFor(() => {
      expect(screen.getByTestId("ai-snapshot-id")).toHaveTextContent("bbbb99998888");
      expect(screen.getByTestId("ai-approval-status")).toHaveTextContent(/Not Approved/i);
    });
  });

  it("supports manual Add Files picker and follow-up Missing Context Detected recovery with fresh approval", async () => {
    const SNAPSHOT_WITH_ADDED: AIContextSnapshot = {
      ...SNAPSHOT_V1,
      snapshotId: "cccc3333444455556666777788889999",
      coverage: {
        totalCandidates: 5,
        selectedFiles: 3,
        includedFiles: 3,
        excludedFiles: 1,
        truncatedFiles: 0,
        perFileMaxBytes: 10240,
        queryIntent: "implementation"
      },
      items: [
        ...SNAPSHOT_V1.items,
        {
          id: "backend/services/quizService.js:1-20",
          filePath: "backend/services/quizService.js",
          language: "javascript",
          contentHash: "hash-quiz-1",
          startLine: 1,
          endLine: 20,
          symbols: ["generateQuiz"],
          reasons: ["explicit-file", "user-added"],
          relevanceScore: 115,
          byteLength: 240,
          estimatedTokens: 60,
          truncated: false,
          content: "export async function generateQuiz() {}"
        }
      ]
    };

    const buildAIContext = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: SNAPSHOT_V1 })
      .mockResolvedValueOnce({ ok: true, data: SNAPSHOT_WITH_ADDED })
      .mockResolvedValueOnce({
        ok: true,
        data: { ...SNAPSHOT_WITH_ADDED, snapshotId: "dddd5555666677778888999900001111" }
      });

    const searchAIContextFiles = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        {
          filePath: "backend/services/quizService.js",
          language: "javascript",
          role: "backend-implementation",
          matchReason: "prefix",
          blockedReason: null
        },
        {
          filePath: ".env",
          language: "text",
          role: "config",
          matchReason: "exact",
          blockedReason: "Sensitive or secret file cannot be included."
        }
      ]
    });

    const resolveAIMissingFiles = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        {
          requestedPath: "backend/routes/quizRoutes.js",
          resolvedPath: "backend/routes/quizRoutes.js",
          status: "exact-match",
          reason: "Verified indexed file inside workspace."
        }
      ]
    });

    let streamListener: ((evt: unknown) => void) | null = null;

    window.codemindDesktop = {
      buildAIContext,
      searchAIContextFiles,
      resolveAIMissingFiles,
      approveAIContext: vi
        .fn()
        .mockImplementation(async (req: { snapshotId: string; approved: boolean }) => ({
          ok: true,
          data: {
            snapshotId: req.snapshotId,
            approved: req.approved,
            approvedAt: req.approved ? "2026-11-22T00:01:00.000Z" : null,
            expiresAt: req.approved ? "2026-11-22T00:31:00.000Z" : null
          }
        })),
      getAIContextApproval: vi.fn(),
      listAIConversations: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      createAIConversation: vi.fn(),
      getAIConversation: vi.fn(),
      deleteAIConversation: vi.fn(),
      startAIStream: vi.fn().mockImplementation(async (req: { requestId: string }) => {
        if (streamListener) {
          streamListener({
            type: "stream:complete",
            requestId: req.requestId,
            content: "To verify routing, inspect `backend/routes/quizRoutes.js`.",
            verifiedReferences: []
          });
        }
        return { ok: true, data: { requestId: req.requestId } };
      }),
      cancelAIStream: vi.fn(),
      onAIStreamEvent: vi.fn().mockImplementation((_id: string, cb: (evt: unknown) => void) => {
        streamListener = cb;
        return () => {
          streamListener = null;
        };
      })
    } as unknown as CodeMindDesktopAPI;

    const user = userEvent.setup();
    render(<ContextPreviewPanel />);

    // 1. Build initial preview
    await user.type(screen.getByLabelText("Context query"), "How does quiz generation work?");
    await user.click(screen.getByRole("button", { name: /Build Context Preview/i }));
    await waitFor(() => {
      expect(screen.getByTestId("ai-context-snapshot")).toBeInTheDocument();
    });

    // 2. Open Add Files picker and verify secret file is shown as Blocked
    await user.click(screen.getByTestId("ai-add-files-toggle"));
    await waitFor(() => {
      expect(screen.getByTestId("ai-add-files-picker")).toBeInTheDocument();
      expect(screen.getByText("backend/services/quizService.js")).toBeInTheDocument();
      expect(screen.getByText("Blocked")).toBeInTheDocument();
    });

    // 3. Manually add backend/services/quizService.js
    await user.click(screen.getByRole("button", { name: "Add backend/services/quizService.js" }));
    await waitFor(() => {
      expect(buildAIContext).toHaveBeenLastCalledWith(
        expect.objectContaining({
          explicitFilePaths: ["backend/services/quizService.js"]
        })
      );
      expect(screen.getByTestId("ai-snapshot-id")).toHaveTextContent("cccc33334444");
      expect(screen.getByTestId("ai-coverage-summary")).toHaveTextContent("3/5 candidates");
    });

    // 4. Approve and stream response mentioning a missing file
    await user.click(screen.getByRole("button", { name: /Approve Context Snapshot/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send Approved Context/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Send Approved Context/i }));

    // 5. Missing Context Detected card appears with verified file
    await waitFor(() => {
      expect(screen.getByTestId("ai-missing-context-card")).toBeInTheDocument();
      expect(screen.getByText("backend/routes/quizRoutes.js")).toBeInTheDocument();
    });

    // 6. Include Selected Files rebuilds snapshot and resets approval to Not Approved
    await user.click(screen.getByRole("button", { name: /Include Selected Files/i }));
    await waitFor(() => {
      expect(buildAIContext).toHaveBeenLastCalledWith(
        expect.objectContaining({
          explicitFilePaths: ["backend/services/quizService.js", "backend/routes/quizRoutes.js"]
        })
      );
      expect(screen.getByTestId("ai-snapshot-id")).toHaveTextContent("dddd55556666");
      expect(screen.getByTestId("ai-approval-status")).toHaveTextContent(/Not Approved/i);
    });
  });
});
