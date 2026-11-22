import { AIProviderError, DecisionStateTransitionError, redactSecrets } from "@codemind/ai-core";
import {
  DecisionAskWhyRequestSchema,
  DecisionCreateFromIntentRequestSchema,
  DecisionCreateRequestSchema,
  DecisionDismissSuggestionRequestSchema,
  DecisionGetRequestSchema,
  DecisionLinkCommitRequestSchema,
  DecisionLinkEvidenceRequestSchema,
  DecisionListGitCommitsRequestSchema,
  DecisionRevalidateRequestSchema,
  DecisionSearchRequestSchema,
  DecisionTimelineRequestSchema,
  DecisionTransitionStatusRequestSchema,
  DecisionUpdateRequestSchema,
  DecisionWorkspaceRequestSchema,
  type AskWhyAnswer,
  type DecisionConflict,
  type DecisionGitReference,
  type DecisionSearchResult,
  type DecisionSuggestion,
  type DecisionTimelineEntry,
  type EngineeringDecision,
  type IpcResponse
} from "@codemind/shared";
import { DecisionEvidenceError } from "../../decisions/decisionEvidenceService.js";
import type { DecisionManager } from "../../decisions/decisionManager.js";
import { WorkspaceSecurityError } from "../../workspace/pathSecurity.js";

function toSafeDecisionError<T>(err: unknown, fallbackCode: string): IpcResponse<T> {
  if (
    err instanceof WorkspaceSecurityError ||
    err instanceof DecisionStateTransitionError ||
    err instanceof DecisionEvidenceError ||
    err instanceof AIProviderError
  ) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: redactSecrets(err.message)
      }
    };
  }
  const msg = err instanceof Error ? err.message : "Decision Memory operation failed.";
  return {
    ok: false,
    error: {
      code: fallbackCode,
      message: redactSecrets(msg)
    }
  };
}

function invalidPayload<T>(issues: Array<{ message: string }>): IpcResponse<T> {
  return {
    ok: false,
    error: {
      code: "INVALID_PAYLOAD",
      message: issues.map((i) => i.message).join("; ")
    }
  };
}

export function createDecisionHandlers(manager: DecisionManager) {
  return {
    async createDecision(payload: unknown): Promise<IpcResponse<EngineeringDecision>> {
      const parsed = DecisionCreateRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await manager.createDecision(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_CREATE_FAILED");
      }
    },

    updateDecision(payload: unknown): IpcResponse<EngineeringDecision> {
      const parsed = DecisionUpdateRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.updateDecision(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_UPDATE_FAILED");
      }
    },

    listDecisions(payload: unknown): IpcResponse<EngineeringDecision[]> {
      const parsed = DecisionWorkspaceRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.listDecisions(parsed.data.workspaceRoot) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_LIST_FAILED");
      }
    },

    getDecision(payload: unknown): IpcResponse<EngineeringDecision> {
      const parsed = DecisionGetRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return {
          ok: true,
          data: manager.getDecision(parsed.data.workspaceRoot, parsed.data.decisionId)
        };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_GET_FAILED");
      }
    },

    deleteDecision(payload: unknown): IpcResponse<{ deleted: boolean }> {
      const parsed = DecisionGetRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        const deleted = manager.deleteDecision(parsed.data.workspaceRoot, parsed.data.decisionId);
        return { ok: true, data: { deleted } };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_DELETE_FAILED");
      }
    },

    transitionStatus(payload: unknown): IpcResponse<EngineeringDecision> {
      const parsed = DecisionTransitionStatusRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.transitionStatus(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_TRANSITION_FAILED");
      }
    },

    async createFromIntent(payload: unknown): Promise<IpcResponse<EngineeringDecision>> {
      const parsed = DecisionCreateFromIntentRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await manager.createDecisionFromIntent(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_CREATE_FROM_INTENT_FAILED");
      }
    },

    suggestDecisions(payload: unknown): IpcResponse<DecisionSuggestion[]> {
      const parsed = DecisionWorkspaceRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.suggestDecisions(parsed.data.workspaceRoot) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_SUGGEST_FAILED");
      }
    },

    dismissSuggestion(payload: unknown): IpcResponse<{ dismissed: boolean }> {
      const parsed = DecisionDismissSuggestionRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return {
          ok: true,
          data: {
            dismissed: manager.dismissSuggestion(
              parsed.data.workspaceRoot,
              parsed.data.suggestionId
            )
          }
        };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_DISMISS_SUGGESTION_FAILED");
      }
    },

    linkEvidence(payload: unknown): IpcResponse<EngineeringDecision> {
      const parsed = DecisionLinkEvidenceRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.linkEvidence(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_LINK_EVIDENCE_FAILED");
      }
    },

    async linkCommit(payload: unknown): Promise<IpcResponse<EngineeringDecision>> {
      const parsed = DecisionLinkCommitRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await manager.linkCommit(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_LINK_COMMIT_FAILED");
      }
    },

    async listGitCommits(payload: unknown): Promise<IpcResponse<DecisionGitReference[]>> {
      const parsed = DecisionListGitCommitsRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return {
          ok: true,
          data: await manager.listGitCommits(parsed.data.workspaceRoot, parsed.data.limit)
        };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_LIST_GIT_COMMITS_FAILED");
      }
    },

    getTimeline(payload: unknown): IpcResponse<DecisionTimelineEntry[]> {
      const parsed = DecisionTimelineRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.getTimeline(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_TIMELINE_FAILED");
      }
    },

    searchDecisions(payload: unknown): IpcResponse<DecisionSearchResult[]> {
      const parsed = DecisionSearchRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.searchDecisions(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_SEARCH_FAILED");
      }
    },

    async askWhy(payload: unknown): Promise<IpcResponse<AskWhyAnswer>> {
      const parsed = DecisionAskWhyRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await manager.askWhy(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_ASK_WHY_FAILED");
      }
    },

    verifyAll(payload: unknown): IpcResponse<EngineeringDecision[]> {
      const parsed = DecisionWorkspaceRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.verifyAllDecisions(parsed.data.workspaceRoot) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_VERIFY_ALL_FAILED");
      }
    },

    revalidate(payload: unknown): IpcResponse<EngineeringDecision> {
      const parsed = DecisionRevalidateRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.revalidateDecision(parsed.data) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_REVALIDATE_FAILED");
      }
    },

    detectConflicts(payload: unknown): IpcResponse<DecisionConflict[]> {
      const parsed = DecisionWorkspaceRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: manager.detectConflicts(parsed.data.workspaceRoot) };
      } catch (err) {
        return toSafeDecisionError(err, "DECISION_DETECT_CONFLICTS_FAILED");
      }
    }
  };
}
