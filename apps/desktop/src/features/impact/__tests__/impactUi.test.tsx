import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImpactAnalysisResult } from "@codemind/shared";
import { useImpactStore } from "../../../stores/impact.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";
import { createIntentBridgeStubs } from "../../../test/intentMockStubs";
import { ImpactSidebarPanel } from "../ImpactSidebarPanel";
import { ImpactWorkspace } from "../ImpactWorkspace";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes }: { nodes: Array<{ id: string; data: { label: string } }> }) => (
    <div data-testid="mock-react-flow">
      {nodes.map((n) => (
        <div key={n.id}>{n.data.label}</div>
      ))}
    </div>
  ),
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null
}));

function makeMockResult(overrides?: Partial<ImpactAnalysisResult>): ImpactAnalysisResult {
  return {
    analysisId: "imp-test-1",
    schemaVersion: 1,
    workspaceId: "ws-1",
    status: "completed",
    completeness: "complete",
    completenessReason: "Full static analysis completed.",
    changeType: "database_contract_changed",
    analyzedTargets: [
      {
        filePath: "backend/models/User.js",
        sourceHash: "abc123",
        existsOnDisk: true
      }
    ],
    impactedFiles: [
      {
        filePath: "backend/controllers/authController.js",
        language: "javascript",
        role: "controller",
        category: "direct",
        depth: 1,
        referencedSymbols: ["User"],
        pathsFromTarget: [["backend/models/User.js", "backend/controllers/authController.js"]],
        evidenceIds: ["ev-1"],
        explanation: "Directly imports User.js"
      },
      {
        filePath: "backend/routes/authRoutes.js",
        language: "javascript",
        role: "route",
        category: "transitive",
        depth: 2,
        referencedSymbols: [],
        pathsFromTarget: [
          [
            "backend/models/User.js",
            "backend/controllers/authController.js",
            "backend/routes/authRoutes.js"
          ]
        ],
        evidenceIds: ["ev-2"],
        explanation: "Transitively depends on User.js"
      }
    ],
    impactedSymbols: [],
    apiContracts: [
      {
        id: "api-1",
        method: "POST",
        endpoint: "/api/auth/login",
        routeFile: "backend/routes/authRoutes.js",
        routeLine: 5,
        controllerFiles: ["backend/controllers/authController.js"],
        frontendConsumers: [
          { filePath: "frontend/src/lib/api.js", line: 2, confidence: "confirmed" }
        ],
        changeKind: "unknown_contract_change",
        contractVerified: false,
        completeness: "partial",
        explanation: "Login route uses authController"
      }
    ],
    databaseContracts: [
      {
        id: "db-1",
        modelName: "User",
        technology: "mongoose",
        schemaFile: "backend/models/User.js",
        fields: [{ name: "role", fieldType: "Number", required: true }],
        consumerFiles: ["backend/controllers/authController.js"],
        detectedChanges: ["field_type_changed"],
        changeDetails: ["Field role changed from String to Number."],
        verified: true,
        explanation: "Mongoose model User changed."
      }
    ],
    impactedTests: [
      {
        id: "t-1",
        testFile: "backend/tests/userModel.test.js",
        relatedSourceFile: "backend/models/User.js",
        dependencyPath: ["backend/models/User.js", "backend/tests/userModel.test.js"],
        classification: "definitely_affected",
        priority: "critical",
        reason: "Directly imports User.js",
        evidenceIds: ["ev-3"]
      }
    ],
    relatedDecisions: [
      {
        decisionId: "dec-1",
        title: "Keep User.role as string enum",
        category: "database",
        status: "accepted",
        verificationStatus: "current",
        provenance: "developer_stated",
        relation: "possible_conflict",
        matchedFiles: ["backend/models/User.js"],
        explanation: "Possible conflict — review recommended."
      }
    ],
    relationships: [],
    evidence: [],
    graphNodes: [
      {
        id: "file:backend/models/User.js",
        label: "models/User.js",
        filePath: "backend/models/User.js",
        kind: "target_file",
        depth: 0,
        category: "direct",
        badge: "TARGET"
      }
    ],
    graphEdges: [],
    risk: {
      score: 76,
      level: "critical",
      calculationVersion: "impact-risk-v1.0.0",
      factors: [
        {
          factorId: "blast_radius",
          label: "Dependency Blast Radius",
          contribution: 10,
          maxContribution: 25,
          explanation: "1 direct, 1 transitive.",
          supportingEvidence: []
        }
      ],
      explanation: "Risk rated CRITICAL (76/100) using impact-risk-v1.0.0.",
      uncertaintyNotes: []
    },
    validationPlan: [
      {
        stepId: "val-1",
        title: "Run affected test suite (1 test file)",
        description: "Run pnpm test",
        category: "unit_test",
        relatedFiles: ["backend/models/User.js"],
        relatedTests: ["backend/tests/userModel.test.js"],
        recommendedCommand: "pnpm test",
        commandId: "cmd-test",
        priority: "critical",
        reason: "1 definitely affected test",
        requiresUserApproval: true,
        executionStatus: "pending"
      }
    ],
    coverage: {
      totalIndexedFiles: 8,
      traversedNodes: 4,
      maxDepthConfigured: 3,
      maxDepthReached: 2,
      truncated: false,
      unresolvedImportCount: 0,
      cyclesDetected: 0,
      durationMs: 14
    },
    limitations: [],
    staleFiles: [],
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

describe("Phase 8 — Change Impact Intelligence UI", () => {
  beforeEach(() => {
    useImpactStore.getState().reset();
    useWorkspaceStore.setState({
      workspace: {
        name: "fixture",
        rootPath: "/workspace/fixture"
      }
    });
    const stubs = createIntentBridgeStubs();
    (window as unknown as { codemindDesktop: unknown }).codemindDesktop = {
      ...stubs,
      listImpactAnalyses: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      updateImpactValidationStep: vi.fn().mockResolvedValue({
        ok: true,
        data: makeMockResult({
          validationPlan: [
            {
              ...makeMockResult().validationPlan[0]!,
              executionStatus: "completed"
            }
          ]
        })
      })
    };
  });

  it("renders sidebar controls and triggers impact analysis", () => {
    render(<ImpactSidebarPanel />);
    expect(screen.getByTestId("impact-sidebar-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze Impact" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Git Diff" })).toBeEnabled();
  });

  it("renders risk breakdown, stale banner, affected file filters, and validation step tracking", async () => {
    const user = userEvent.setup();
    useImpactStore.setState({
      activeAnalysis: makeMockResult({
        status: "stale",
        staleFiles: ["backend/models/User.js"]
      })
    });

    render(<ImpactWorkspace />);

    expect(screen.getByTestId("impact-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("impact-risk-badge")).toHaveTextContent("CRITICAL RISK · 76/100");
    expect(screen.getByTestId("impact-stale-banner")).toHaveTextContent("backend/models/User.js");
    expect(screen.getByTestId("impact-graph-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("impact-risk-factors")).toHaveTextContent("Dependency Blast Radius");

    // Switch to Affected Files tab and filter by DIRECT
    await user.click(screen.getByRole("tab", { name: /Affected Files/i }));
    expect(screen.getByText("backend/controllers/authController.js")).toBeInTheDocument();
    expect(screen.getByText("backend/routes/authRoutes.js")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "DIRECT" }));
    expect(screen.getByText("backend/controllers/authController.js")).toBeInTheDocument();
    expect(screen.queryByText("backend/routes/authRoutes.js")).not.toBeInTheDocument();

    // Switch to Validation Plan tab and mark step completed
    await user.click(screen.getByRole("tab", { name: /Validation Plan/i }));
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "completed" }));
    expect(screen.getByTestId("val-step-val-1")).toHaveTextContent("completed");
  });

  it("Review 8: displays explicit loading state while analyzing with no active report", () => {
    useImpactStore.setState({ activeAnalysis: null, isAnalyzing: true });
    render(<ImpactWorkspace />);
    expect(screen.getByTestId("impact-workspace-loading")).toHaveTextContent(
      "Analyzing Change Impact..."
    );
  });
});
