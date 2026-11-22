import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeMindDesktopAPI, IntentSession } from "@codemind/shared";
import { useIntentStore } from "../../../stores/intent.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";
import { createIntentBridgeStubs } from "../../../test/intentMockStubs";
import { IntentSidebarPanel } from "../IntentSidebarPanel";
import { IntentWorkspace } from "../IntentWorkspace";

vi.mock("../../../components/editor/monacoSetup", () => ({
  ensureMonacoConfigured: vi.fn()
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="mock-monaco-diff">
      <pre>{original}</pre>
      <pre>{modified}</pre>
    </div>
  ),
  loader: { config: vi.fn() }
}));

const MOCK_SESSION: IntentSession = {
  intent: {
    intentId: "intent-ui-1",
    workspaceId: "C:\\projects\\demo",
    originalPrompt: "Fix login error on invalid password",
    normalizedGoal: "Fix login error on invalid password",
    intentType: "bug_fix",
    constraints: [],
    acceptanceCriteria: [
      { id: "ac-1", description: "Fix login error", source: "user", confirmed: true }
    ],
    affectedAreas: ["login", "password"],
    relevantFiles: [],
    userPreferences: {},
    ambiguity: { isAmbiguous: false, reasons: [], missingInformation: [] },
    clarificationQuestions: [],
    confidence: "high",
    status: "awaiting_review",
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z"
  },
  investigation: null,
  analysis: null,
  recommendations: [],
  patches: [
    {
      patchId: "patch-1",
      intentId: "intent-ui-1",
      recommendationIds: ["rec-1"],
      targetFile: "backend/services/authService.js",
      language: "javascript",
      originalFileHash: "hash-orig-1111111111",
      proposedFileHash: "hash-prop-2222222222",
      originalContentVersion: 1,
      originalContent: "export function verifyPassword(p) { return p === 'secret'; }",
      proposedContent: "export function verifyPassword(p) { return Boolean(p) && p === 'secret'; }",
      unifiedDiff: "--- a/backend/services/authService.js\n+++ b/backend/services/authService.js\n",
      changedLineRanges: [{ startLine: 1, endLine: 1 }],
      addedLines: 1,
      removedLines: 1,
      patchSummary: "Guard empty password",
      validation: { valid: true, errors: [], warnings: [], stale: false },
      reviewDecision: "pending",
      generatedAt: "2026-11-22T00:00:00.000Z"
    }
  ],
  approvals: [],
  transactions: [],
  verifications: [],
  rollbacks: [],
  auditEvents: []
};

describe("Phase 6 UI — IntentSidebarPanel, IntentWorkspace & Monaco Diff Review", () => {
  beforeEach(() => {
    useIntentStore.getState().resetForWorkspace();
    useWorkspaceStore.setState({
      workspace: { rootPath: "C:\\projects\\demo", name: "demo" }
    });
  });

  afterEach(() => {
    delete window.codemindDesktop;
    useWorkspaceStore.setState({ workspace: null });
    useIntentStore.getState().resetForWorkspace();
  });

  it("creates an intent, renders Monaco Diff Editor, and records patch review decision without writing files", async () => {
    const stubs = createIntentBridgeStubs();
    const createIntent = vi.fn().mockResolvedValue({ ok: true, data: MOCK_SESSION });
    const reviewIntentPatch = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        ...MOCK_SESSION,
        patches: [{ ...MOCK_SESSION.patches[0]!, reviewDecision: "accepted" }]
      }
    });

    window.codemindDesktop = {
      ...stubs,
      createIntent,
      reviewIntentPatch,
      listIntents: vi.fn().mockResolvedValue({ ok: true, data: [] })
    } as unknown as CodeMindDesktopAPI;

    const user = userEvent.setup();
    render(
      <>
        <IntentSidebarPanel />
        <IntentWorkspace />
      </>
    );

    await user.type(
      screen.getByLabelText("Engineering intent prompt"),
      "Fix login error on invalid password"
    );
    await user.click(screen.getByRole("button", { name: /Start Intent/i }));

    await waitFor(() => {
      expect(screen.getByTestId("intent-workspace")).toBeInTheDocument();
    });

    // Switch to Diff Review tab and inspect Monaco Diff Editor
    await user.click(screen.getByRole("tab", { name: /5\. Diff Review/i }));
    await waitFor(() => {
      expect(screen.getByTestId("intent-diff-reviewer")).toBeInTheDocument();
      expect(screen.getByTestId("mock-monaco-diff")).toBeInTheDocument();
    });

    // Accept file registers review decision only (applyPatchTransaction NOT called)
    await user.click(screen.getByRole("button", { name: /Accept File/i }));
    await waitFor(() => {
      expect(reviewIntentPatch).toHaveBeenCalledWith({
        workspaceRoot: "C:\\projects\\demo",
        intentId: "intent-ui-1",
        patchIds: ["patch-1"],
        decision: "accepted"
      });
      expect(stubs.applyPatchTransaction).not.toHaveBeenCalled();
    });
  });
});
