import { AIProviderError, redactSecrets } from "@codemind/ai-core";
import {
  AIConversationCreateRequestSchema,
  AIConversationDeleteRequestSchema,
  AIConversationGetRequestSchema,
  AIConversationListRequestSchema,
  AIConversationRenameRequestSchema,
  AIStreamCancelRequestSchema,
  AIStreamCancelResponseSchema,
  AIStreamStartRequestSchema,
  AIStreamStartResponseSchema,
  AIUsageSummarySchema,
  ConversationPageSchema,
  ConversationSummarySchema,
  type AIStreamCancelResponse,
  type AIStreamStartResponse,
  type AIUsageSummary,
  type ConversationPage,
  type ConversationSummary,
  type IpcResponse
} from "@codemind/shared";
import { z } from "zod";
import { ContextApprovalError } from "../../ai/contextApprovalStore.js";
import { ConversationStoreError, type ConversationStore } from "../../ai/conversationStore.js";
import { CredentialStoreError } from "../../ai/credentialStore.js";
import type { AIStreamManager, StreamEventEmitter } from "../../ai/streamManager.js";
import type { AIUsageStore } from "../../ai/usageStore.js";
import type { PreferencesStore } from "../../utils/preferences.js";
import { WorkspaceSecurityError, type WorkspaceAuthority } from "../../workspace/pathSecurity.js";

function toSafeError<T>(err: unknown, fallbackCode: string): IpcResponse<T> {
  if (
    err instanceof WorkspaceSecurityError ||
    err instanceof ContextApprovalError ||
    err instanceof CredentialStoreError ||
    err instanceof ConversationStoreError ||
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
  const msg = err instanceof Error ? err.message : "AI operation failed.";
  return {
    ok: false,
    error: {
      code: fallbackCode,
      message: redactSecrets(msg)
    }
  };
}

export function createAIStreamAndConversationHandlers(deps: {
  authority: WorkspaceAuthority;
  preferences: PreferencesStore;
  streamManager: AIStreamManager;
  conversationStore: ConversationStore;
  usageStore: AIUsageStore;
}) {
  return {
    startStream(payload: unknown, emit: StreamEventEmitter): IpcResponse<AIStreamStartResponse> {
      const parsed = AIStreamStartRequestSchema.safeParse(payload);
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
        const requestId = deps.streamManager.startStream(
          {
            requestId: parsed.data.requestId,
            workspaceRoot: parsed.data.workspaceRoot,
            snapshotId: parsed.data.snapshotId,
            modelId: parsed.data.model,
            maxOutputTokens: parsed.data.maxOutputTokens,
            structured: parsed.data.structured,
            structuredKind: parsed.data.structuredKind,
            conversationId: parsed.data.conversationId
          },
          emit
        );
        return { ok: true, data: AIStreamStartResponseSchema.parse({ requestId }) };
      } catch (err) {
        return toSafeError(err, "AI_STREAM_START_FAILED");
      }
    },

    cancelStream(payload: unknown): IpcResponse<AIStreamCancelResponse> {
      const parsed = AIStreamCancelRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      const cancelled = deps.streamManager.cancel(parsed.data.requestId);
      return {
        ok: true,
        data: AIStreamCancelResponseSchema.parse({
          requestId: parsed.data.requestId,
          cancelled
        })
      };
    },

    createConversation(payload: unknown): IpcResponse<ConversationSummary> {
      const parsed = AIConversationCreateRequestSchema.safeParse(payload);
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
        const aiPrefs = deps.preferences.getAISettings();
        const conv = deps.conversationStore.createConversation({
          workspaceRoot: realRoot,
          title: parsed.data.title,
          taskType: parsed.data.taskType,
          model: aiPrefs.model
        });
        return { ok: true, data: ConversationSummarySchema.parse(conv) };
      } catch (err) {
        return toSafeError(err, "AI_CONVERSATION_CREATE_FAILED");
      }
    },

    listConversations(payload: unknown): IpcResponse<ConversationSummary[]> {
      const parsed = AIConversationListRequestSchema.safeParse(payload);
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
        const list = deps.conversationStore.listConversations(
          realRoot,
          parsed.data.includeArchived ?? false
        );
        return { ok: true, data: z.array(ConversationSummarySchema).parse(list) };
      } catch (err) {
        return toSafeError(err, "AI_CONVERSATION_LIST_FAILED");
      }
    },

    getConversation(payload: unknown): IpcResponse<ConversationPage> {
      const parsed = AIConversationGetRequestSchema.safeParse(payload);
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
        const page = deps.conversationStore.getConversationPage({
          workspaceRoot: realRoot,
          conversationId: parsed.data.conversationId,
          limit: parsed.data.limit,
          cursor: parsed.data.cursor
        });
        return { ok: true, data: ConversationPageSchema.parse(page) };
      } catch (err) {
        return toSafeError(err, "AI_CONVERSATION_GET_FAILED");
      }
    },

    renameConversation(payload: unknown): IpcResponse<ConversationSummary> {
      const parsed = AIConversationRenameRequestSchema.safeParse(payload);
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
        const updated = deps.conversationStore.renameConversation(
          realRoot,
          parsed.data.conversationId,
          parsed.data.title
        );
        return { ok: true, data: ConversationSummarySchema.parse(updated) };
      } catch (err) {
        return toSafeError(err, "AI_CONVERSATION_RENAME_FAILED");
      }
    },

    deleteConversation(payload: unknown): IpcResponse<{ deleted: boolean }> {
      const parsed = AIConversationDeleteRequestSchema.safeParse(payload);
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
        const deleted = deps.conversationStore.deleteConversation(
          realRoot,
          parsed.data.conversationId
        );
        return { ok: true, data: { deleted } };
      } catch (err) {
        return toSafeError(err, "AI_CONVERSATION_DELETE_FAILED");
      }
    },

    getUsageSummary(): IpcResponse<AIUsageSummary> {
      try {
        return { ok: true, data: AIUsageSummarySchema.parse(deps.usageStore.getSummary()) };
      } catch (err) {
        return toSafeError(err, "AI_USAGE_READ_FAILED");
      }
    }
  };
}
