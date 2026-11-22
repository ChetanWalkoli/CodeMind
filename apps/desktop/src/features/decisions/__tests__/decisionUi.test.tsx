import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DECISION_SCHEMA_VERSION,
  type CodeMindDesktopAPI,
  type EngineeringDecision
} from "@codemind/shared";
import { useDecisionStore } from "../../../stores/decision.store";
import { useEditorStore } from "../../../stores/editor.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";
import { createIntentBridgeStubs } from "../../../test/intentMockStubs";
import { DecisionMemoryWorkspace } from "../DecisionMemoryWorkspace";
import { DecisionSidebarPanel } from "../DecisionSidebarPanel";

const MOCK_DECISION: EngineeringDecision = {
  id: "dec-ui-1",
  workspaceId: "C:\\projects\\demo",
  title: "Use JWT authentication",
  summary: "Stateless JWT tokens",
  context: "API authentication",
  problem: "Avoid server sessions",
  decision: "Verify JWT in authMiddleware.ts",
  rationale: "Stateless verification",
  status: "accepted",
  category: "authentication",
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
  decidedAt: "2026-11-22T00:00:00.000Z",
  createdBy: "developer",
  source: "manual",
  confidence: "stale",
  tags: ["jwt"],
  alternatives: [
    {
      id: "alt-1",
      name: "Sessions",
      description: "Server-side sessions",
      advantages: ["Easy revocation"],
      disadvantages: ["Stateful store"],
      rejectionReason: "Extra infrastructure",
      evaluationStatus: "rejected"
    }
  ],
  evidence: [
    {
      id: "ev-1",
      type: "source_file",
      filePath: "src/auth/authMiddleware.ts",
      startLine: 5,
      endLine: 20,
      contentHash: "hash-1",
      description: "JWT verification middleware",
      verificationStatus: "stale",
      provenance: "stale",
      timestamp: "2026-11-22T00:00:00.000Z",
      staleReason: "File modified on disk",
      isHistorical: false
    }
  ],
  tradeoffs: [],
  relatedDecisionIds: [],
  supersededById: null,
  relatedIntentId: null,
  gitReferences: [],
  verificationStatus: "stale",
  history: [
    {
      id: "h-1",
      type: "created",
      summary: "Created JWT decision",
      timestamp: "2026-11-22T00:00:00.000Z",
      actor: "developer"
    }
  ],
  schemaVersion: DECISION_SCHEMA_VERSION
};

describe("Phase 7 UI — DecisionMemoryWorkspace & DecisionSidebarPanel", () => {
  beforeEach(() => {
    useDecisionStore.getState().resetForWorkspace();
    useEditorStore.getState().resetToInitial();
    useWorkspaceStore.setState({
      workspace: { rootPath: "C:\\projects\\demo", name: "demo" }
    });
  });

  afterEach(() => {
    delete window.codemindDesktop;
    useWorkspaceStore.setState({ workspace: null });
    useDecisionStore.getState().resetForWorkspace();
  });

  it("displays stale decision detail, navigates evidence to editor, and renders Ask Why answers", async () => {
    const stubs = createIntentBridgeStubs();
    const askWhyDecision = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        question: "Why JWT?",
        answered: true,
        recordedDecision: "Verify JWT in authMiddleware.ts",
        reason: "Stateless verification",
        alternatives: MOCK_DECISION.alternatives,
        tradeoffs: [],
        evidence: MOCK_DECISION.evidence,
        gitReferences: [],
        matchedDecisionIds: ["dec-ui-1"],
        relatedDecisionIds: [],
        confidence: "stale",
        currentStatus: "accepted",
        verificationStatus: "stale",
        usedAiSynthesis: false,
        honestNotice: "Warning: linked evidence is stale."
      }
    });

    window.codemindDesktop = {
      ...stubs,
      listDecisions: vi.fn().mockResolvedValue({ ok: true, data: [MOCK_DECISION] }),
      askWhyDecision,
      readFile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          relativePath: "src/auth/authMiddleware.ts",
          content: "export function verifyJwtToken() { return true; }",
          contentHash: "hash-2",
          modifiedAtMs: Date.now(),
          sizeBytes: 49,
          isSecret: false
        }
      })
    } as unknown as CodeMindDesktopAPI;

    const user = userEvent.setup();
    render(
      <>
        <DecisionSidebarPanel />
        <DecisionMemoryWorkspace />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId("decision-sidebar-list")).toHaveTextContent(
        "Use JWT authentication"
      );
    });

    // Click decision in sidebar -> opens Detail View with stale indicator & Revalidate button
    await user.click(screen.getAllByRole("button", { name: /Use JWT authentication/i })[0]!);
    await waitFor(() => {
      expect(screen.getByTestId("decision-detail-view")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Revalidate Evidence/i })).toBeInTheDocument();
      expect(screen.getByText("File modified on disk")).toBeInTheDocument();
    });

    // Switch to Ask Why tab and query
    await user.click(screen.getByRole("tab", { name: "Ask Why" }));
    await user.type(screen.getByLabelText("Ask why question"), "Why JWT?");
    await user.click(screen.getAllByRole("button", { name: /^Ask Why$/i })[1]!);

    await waitFor(() => {
      expect(screen.getByTestId("ask-why-result")).toHaveTextContent(
        "Verify JWT in authMiddleware.ts"
      );
      expect(screen.getByTestId("ask-why-result")).toHaveTextContent(
        "Warning: linked evidence is stale."
      );
    });
  });
});
