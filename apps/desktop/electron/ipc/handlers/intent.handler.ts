import { AIProviderError, IntentStateTransitionError, redactSecrets } from "@codemind/ai-core";
import {
  IntentAnalyzeRequestSchema,
  IntentApplyPatchTxRequestSchema,
  IntentApprovePatchTxRequestSchema,
  IntentCancelVerificationRequestSchema,
  IntentCheckRollbackRequestSchema,
  IntentClarifyRequestSchema,
  IntentCreateRequestSchema,
  IntentDecideRecommendationRequestSchema,
  IntentDiscoverVerificationRequestSchema,
  IntentExecuteRollbackRequestSchema,
  IntentGeneratePatchRequestSchema,
  IntentGetRequestSchema,
  IntentInvestigateRequestSchema,
  IntentListRequestSchema,
  IntentRecommendRequestSchema,
  IntentReviewPatchRequestSchema,
  IntentRunVerificationRequestSchema,
  type IntentSession,
  type IntentSessionSummary,
  type IpcResponse,
  type PatchApprovalRecord,
  type PatchTransactionRecord,
  type RollbackCheckResult,
  type RollbackRecord,
  type VerificationCandidateCommand,
  type VerificationRunRecord
} from "@codemind/shared";
import type { IntentOrchestrator } from "../../intent/intentOrchestrator.js";
import { PatchApplicationError } from "../../intent/patchApplicationEngine.js";
import { PatchSecurityError } from "../../intent/patchService.js";
import { RollbackSecurityError } from "../../intent/recoveryManager.js";
import { VerificationSecurityError } from "../../intent/verificationEngine.js";
import { WorkspaceSecurityError } from "../../workspace/pathSecurity.js";

function toSafeIntentError<T>(err: unknown, fallbackCode: string): IpcResponse<T> {
  if (
    err instanceof WorkspaceSecurityError ||
    err instanceof IntentStateTransitionError ||
    err instanceof PatchSecurityError ||
    err instanceof PatchApplicationError ||
    err instanceof VerificationSecurityError ||
    err instanceof RollbackSecurityError ||
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
  const msg = err instanceof Error ? err.message : "Intent operation failed.";
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

export function createIntentHandlers(orchestrator: IntentOrchestrator) {
  return {
    async createIntent(payload: unknown): Promise<IpcResponse<IntentSession>> {
      const parsed = IntentCreateRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await orchestrator.createIntent(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_CREATE_FAILED");
      }
    },

    listIntents(payload: unknown): IpcResponse<IntentSessionSummary[]> {
      const parsed = IntentListRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: orchestrator.listIntents(parsed.data.workspaceRoot) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_LIST_FAILED");
      }
    },

    getIntent(payload: unknown): IpcResponse<IntentSession> {
      const parsed = IntentGetRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return {
          ok: true,
          data: orchestrator.getIntent(parsed.data.workspaceRoot, parsed.data.intentId)
        };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_GET_FAILED");
      }
    },

    clarifyIntent(payload: unknown): IpcResponse<IntentSession> {
      const parsed = IntentClarifyRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: orchestrator.clarifyIntent(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_CLARIFY_FAILED");
      }
    },

    cancelIntent(payload: unknown): IpcResponse<IntentSession> {
      const parsed = IntentGetRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return {
          ok: true,
          data: orchestrator.cancelIntent(parsed.data.workspaceRoot, parsed.data.intentId)
        };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_CANCEL_FAILED");
      }
    },

    deleteIntent(payload: unknown): IpcResponse<{ deleted: boolean }> {
      const parsed = IntentGetRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        const deleted = orchestrator.deleteIntent(parsed.data.workspaceRoot, parsed.data.intentId);
        return { ok: true, data: { deleted } };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_DELETE_FAILED");
      }
    },

    async investigateIntent(payload: unknown): Promise<IpcResponse<IntentSession>> {
      const parsed = IntentInvestigateRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await orchestrator.investigateIntent(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_INVESTIGATE_FAILED");
      }
    },

    analyzeIntent(payload: unknown): IpcResponse<IntentSession> {
      const parsed = IntentAnalyzeRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: orchestrator.analyzeIntent(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_ANALYZE_FAILED");
      }
    },

    recommendIntent(payload: unknown): IpcResponse<IntentSession> {
      const parsed = IntentRecommendRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return {
          ok: true,
          data: orchestrator.recommendIntent(parsed.data.workspaceRoot, parsed.data.intentId)
        };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_RECOMMEND_FAILED");
      }
    },

    decideRecommendation(payload: unknown): IpcResponse<IntentSession> {
      const parsed = IntentDecideRecommendationRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: orchestrator.decideRecommendation(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_DECIDE_RECOMMENDATION_FAILED");
      }
    },

    async generatePatch(payload: unknown): Promise<IpcResponse<IntentSession>> {
      const parsed = IntentGeneratePatchRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await orchestrator.generatePatch(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_GENERATE_PATCH_FAILED");
      }
    },

    reviewPatch(payload: unknown): IpcResponse<IntentSession> {
      const parsed = IntentReviewPatchRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: orchestrator.reviewPatch(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_REVIEW_PATCH_FAILED");
      }
    },

    approvePatchTx(payload: unknown): IpcResponse<PatchApprovalRecord> {
      const parsed = IntentApprovePatchTxRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: orchestrator.approvePatchTransaction(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_APPROVE_PATCH_TX_FAILED");
      }
    },

    async applyPatchTx(payload: unknown): Promise<IpcResponse<PatchTransactionRecord>> {
      const parsed = IntentApplyPatchTxRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await orchestrator.applyPatchTransaction(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_APPLY_PATCH_TX_FAILED");
      }
    },

    discoverVerification(payload: unknown): IpcResponse<VerificationCandidateCommand[]> {
      const parsed = IntentDiscoverVerificationRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return {
          ok: true,
          data: orchestrator.discoverVerificationCommands(parsed.data.workspaceRoot)
        };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_DISCOVER_VERIFICATION_FAILED");
      }
    },

    async runVerification(payload: unknown): Promise<IpcResponse<VerificationRunRecord>> {
      const parsed = IntentRunVerificationRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await orchestrator.runVerificationCommand(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_RUN_VERIFICATION_FAILED");
      }
    },

    cancelVerification(payload: unknown): IpcResponse<{ cancelled: boolean }> {
      const parsed = IntentCancelVerificationRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return {
          ok: true,
          data: { cancelled: orchestrator.cancelVerificationCommand(parsed.data.verificationId) }
        };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_CANCEL_VERIFICATION_FAILED");
      }
    },

    checkRollback(payload: unknown): IpcResponse<RollbackCheckResult> {
      const parsed = IntentCheckRollbackRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: orchestrator.checkTransactionRollback(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_CHECK_ROLLBACK_FAILED");
      }
    },

    async executeRollback(payload: unknown): Promise<IpcResponse<RollbackRecord>> {
      const parsed = IntentExecuteRollbackRequestSchema.safeParse(payload);
      if (!parsed.success) return invalidPayload(parsed.error.issues);
      try {
        return { ok: true, data: await orchestrator.executeTransactionRollback(parsed.data) };
      } catch (err) {
        return toSafeIntentError(err, "INTENT_EXECUTE_ROLLBACK_FAILED");
      }
    }
  };
}
