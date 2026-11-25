import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useActivityStore } from "../../../stores/activity.store";
import { useDecisionStore } from "../../../stores/decision.store";
import { useImpactStore } from "../../../stores/impact.store";
import { useWorkspaceStore } from "../../../stores/workspace.store";
import { createIntentBridgeStubs } from "../../../test/intentMockStubs";
import { ActivityWorkspace } from "../../activity/ActivityWorkspace";
import { OnboardingModal } from "../../onboarding/OnboardingModal";
import { OverviewWorkspace } from "../OverviewWorkspace";

describe("Phase 9 — Unified Shell, Overview, Activity & Onboarding UI", () => {
  beforeEach(() => {
    useActivityStore.getState().reset();
    useDecisionStore.getState().resetForWorkspace();
    useImpactStore.getState().reset();
    useWorkspaceStore.setState({
      workspace: {
        name: "demo-repo",
        rootPath: "/workspace/demo-repo"
      },
      indexSummary: {
        workspaceRoot: "/workspace/demo-repo",
        totalFiles: 24,
        indexedFiles: 24,
        totalSymbols: 112,
        totalEdges: 48,
        diagnosticCount: 0,
        durationMs: 120,
        indexedAt: new Date().toISOString()
      },
      gitStatus: {
        isGitRepo: true,
        branch: "main",
        isDirty: true,
        modifiedCount: 2
      }
    });

    const stubs = createIntentBridgeStubs();
    (window as unknown as { codemindDesktop: unknown }).codemindDesktop = {
      ...stubs,
      listActivityEvents: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          {
            id: "act-1",
            workspaceId: "ws-1",
            eventType: "codebase_indexed",
            timestamp: new Date().toISOString(),
            feature: "understand",
            relatedFiles: ["src/auth.ts"],
            summary: "Indexed 24 files and 112 symbols.",
            status: "success",
            schemaVersion: 1
          }
        ]
      })
    };
  });

  it("renders OverviewWorkspace with real workspace stats and 4-pillar navigation", () => {
    render(<OverviewWorkspace />);
    expect(screen.getByTestId("overview-workspace")).toBeInTheDocument();
    expect(screen.getByText("demo-repo")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("Explore Architecture")).toBeInTheDocument();
    expect(screen.getByText("Intent Mode")).toBeInTheDocument();
    expect(screen.getByText("Decision Memory")).toBeInTheDocument();
    expect(screen.getByText("Change Impact")).toBeInTheDocument();
  });

  it("renders ActivityWorkspace feed from workspace-isolated store", async () => {
    render(<ActivityWorkspace />);
    expect(screen.getByTestId("activity-workspace")).toBeInTheDocument();
    expect(await screen.findByText("Indexed 24 files and 112 symbols.")).toBeInTheDocument();
  });

  it("allows stepping through or skipping OnboardingModal without forcing Gemini setup", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<OnboardingModal open={true} onClose={onClose} />);

    expect(screen.getByTestId("onboarding-modal")).toBeInTheDocument();
    expect(screen.getByText("Welcome to CodeMind")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Local-First Workspace & Indexing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
