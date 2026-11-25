import { useDecisionStore } from "../stores/decision.store";
import { useEditorStore } from "../stores/editor.store";
import { useImpactStore } from "../stores/impact.store";
import { useIntentStore } from "../stores/intent.store";
import { useWorkspaceStore } from "../stores/workspace.store";

export interface EvidenceLocation {
  workspaceRoot: string;
  filePath: string;
  line?: number;
  symbolName?: string;
}

/**
 * Milestone 9.3F — Shared Evidence Navigation Contract.
 * Verifies active workspace identity, opens the file in Monaco at the target line,
 * and switches the center pane to the editor.
 */
export async function navigateToEvidence(loc: EvidenceLocation): Promise<boolean> {
  const ws = useWorkspaceStore.getState().workspace;
  if (!ws || ws.rootPath !== loc.workspaceRoot) {
    return false;
  }
  await useEditorStore
    .getState()
    .openWorkspaceFile(loc.workspaceRoot, loc.filePath, loc.line ? { line: loc.line } : undefined);
  useWorkspaceStore.getState().setCenterView("editor");
  return true;
}

/**
 * Milestone 9.3A & 9.3E — Cross-feature launch into Intent Mode (Understand -> Improve, Predict -> Improve).
 * Creates a real Intent session with grounded references; still requires fresh context preview & approval
 * before transmitting any source code to Gemini.
 */
export async function launchIntentFromContext(params: {
  workspaceRoot: string;
  goal: string;
}): Promise<boolean> {
  const ws = useWorkspaceStore.getState().workspace;
  if (!ws || ws.rootPath !== params.workspaceRoot) {
    return false;
  }
  useWorkspaceStore.getState().setActiveNav("intent");
  const created = await useIntentStore.getState().createIntent(params.workspaceRoot, params.goal);
  return Boolean(created);
}

/**
 * Milestone 9.3D — Navigate from Change Impact (or Activity) straight to a Decision Memory record.
 */
export async function navigateToDecisionRecord(
  workspaceRoot: string,
  decisionId: string
): Promise<void> {
  useWorkspaceStore.getState().setActiveNav("decisions");
  await useDecisionStore.getState().loadAll(workspaceRoot);
  useDecisionStore.getState().selectDecision(decisionId);
}

/**
 * Navigate from Activity (or Overview) straight to an Impact Analysis record.
 */
export async function navigateToImpactRecord(
  workspaceRoot: string,
  analysisId: string
): Promise<void> {
  useWorkspaceStore.getState().setActiveNav("impact");
  await useImpactStore.getState().selectAnalysis(workspaceRoot, analysisId);
}

/**
 * Navigate from Activity straight to an Intent Mode session.
 */
export async function navigateToIntentRecord(
  workspaceRoot: string,
  sessionId: string
): Promise<void> {
  useWorkspaceStore.getState().setActiveNav("intent");
  await useIntentStore.getState().selectSession(workspaceRoot, sessionId);
}
