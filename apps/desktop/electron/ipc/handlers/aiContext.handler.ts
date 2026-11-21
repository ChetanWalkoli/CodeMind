import {
  AIProviderError,
  budgetContextForModel,
  computeContextSnapshotId,
  redactSecrets
} from "@codemind/ai-core";
import {
  AIContextApprovalRecordSchema,
  AIContextApprovalRequestSchema,
  AIContextBuildRequestSchema,
  AIContextGetApprovalRequestSchema,
  AIContextSnapshotSchema,
  AIExecuteApprovedRequestSchema,
  AIExecuteApprovedResultSchema,
  type AIContextApprovalRecord,
  type AIContextSnapshot,
  type AIExecuteApprovedResult,
  type IpcResponse
} from "@codemind/shared";
import { ContextApprovalError, type ContextApprovalStore } from "../../ai/contextApprovalStore.js";
import type { WorkspaceContextBuilder } from "../../ai/contextBuilder.js";
import { CredentialStoreError } from "../../ai/credentialStore.js";
import type { SecureTransmissionGate } from "../../ai/transmissionGate.js";
import type { PreferencesStore } from "../../utils/preferences.js";
import { WorkspaceSecurityError, type WorkspaceAuthority } from "../../workspace/pathSecurity.js";
import type { CodeEngineManager } from "./engine.handler.js";

function toSafeError<T>(err: unknown, fallbackCode: string): IpcResponse<T> {
  if (
    err instanceof WorkspaceSecurityError ||
    err instanceof ContextApprovalError ||
    err instanceof CredentialStoreError ||
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
  const msg = err instanceof Error ? err.message : "AI context operation failed.";
  return {
    ok: false,
    error: {
      code: fallbackCode,
      message: redactSecrets(msg)
    }
  };
}

/**
 * IPC handlers for local-only context assembly, explicit snapshot approval,
 * and gated execution of approved snapshots via SecureTransmissionGate.
 */
export function createAIContextHandlers(deps: {
  authority: WorkspaceAuthority;
  preferences: PreferencesStore;
  engineManager: CodeEngineManager;
  contextBuilder: WorkspaceContextBuilder;
  approvalStore: ContextApprovalStore;
  transmissionGate?: SecureTransmissionGate;
}) {
  return {
    async buildContext(payload: unknown): Promise<IpcResponse<AIContextSnapshot>> {
      const parsed = AIContextBuildRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        const customExcludes = deps.preferences.getWorkspaceSession().customExcludes;

        let indexer = deps.engineManager.get(realRoot);
        if (!indexer) {
          indexer = deps.engineManager.getOrCreate(realRoot, customExcludes);
          await indexer.indexWorkspace();
        }

        const rawSnapshot = deps.contextBuilder.buildSnapshot({
          authorizedRoot: realRoot,
          indexer,
          request: parsed.data,
          customExcludes
        });

        const aiPrefs = deps.preferences.getAISettings();
        const budgeted = budgetContextForModel(rawSnapshot, {
          modelId: aiPrefs.model
        });

        const finalSnapshotId = computeContextSnapshotId({
          workspaceRoot: budgeted.snapshot.workspaceRoot,
          taskType: budgeted.snapshot.taskType,
          templateId: budgeted.snapshot.templateId,
          templateVersion: budgeted.snapshot.templateVersion,
          query: budgeted.snapshot.query,
          items: budgeted.snapshot.items
        });

        const finalSnapshot: AIContextSnapshot = {
          ...budgeted.snapshot,
          snapshotId: finalSnapshotId
        };

        const validated = AIContextSnapshotSchema.parse(finalSnapshot);
        deps.approvalStore.registerSnapshot(validated);
        return { ok: true, data: validated };
      } catch (err) {
        return toSafeError(err, "AI_CONTEXT_BUILD_FAILED");
      }
    },

    approveContext(payload: unknown): IpcResponse<AIContextApprovalRecord> {
      const parsed = AIContextApprovalRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        const record = deps.approvalStore.setApproval(
          realRoot,
          parsed.data.snapshotId,
          parsed.data.approved
        );
        return { ok: true, data: AIContextApprovalRecordSchema.parse(record) };
      } catch (err) {
        return toSafeError(err, "AI_CONTEXT_APPROVE_FAILED");
      }
    },

    getContextApproval(payload: unknown): IpcResponse<AIContextApprovalRecord> {
      const parsed = AIContextGetApprovalRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        const record = deps.approvalStore.getApproval(realRoot, parsed.data.snapshotId);
        return { ok: true, data: AIContextApprovalRecordSchema.parse(record) };
      } catch (err) {
        return toSafeError(err, "AI_CONTEXT_APPROVAL_READ_FAILED");
      }
    },

    async executeApprovedContext(payload: unknown): Promise<IpcResponse<AIExecuteApprovedResult>> {
      const parsed = AIExecuteApprovedRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      if (!deps.transmissionGate) {
        return {
          ok: false,
          error: {
            code: "TRANSMISSION_GATE_UNAVAILABLE",
            message: "AI transmission gate is not configured."
          }
        };
      }

      try {
        const result = await deps.transmissionGate.executeApprovedContext({
          workspaceRoot: parsed.data.workspaceRoot,
          snapshotId: parsed.data.snapshotId,
          modelId: parsed.data.model,
          maxOutputTokens: parsed.data.maxOutputTokens
        });
        return { ok: true, data: AIExecuteApprovedResultSchema.parse(result) };
      } catch (err) {
        return toSafeError(err, "AI_EXECUTE_APPROVED_FAILED");
      }
    }
  };
}
