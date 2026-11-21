import crypto from "node:crypto";
import {
  AIProviderError,
  AIRateLimiter,
  DESKTOP_RATE_LIMIT_CONFIG,
  getStructuredInstructions,
  isAbortError,
  normalizeProviderError,
  parseAndValidateStructuredResponse,
  redactSecrets,
  resolveStructuredKindForTask,
  type AIMessage
} from "@codemind/ai-core";
import {
  AIStreamIpcEventSchema,
  type AIProviderName,
  type AIStreamIpcEvent,
  type AIUsageMetrics,
  type StructuredResponseKind,
  type VerifiedSourceReferenceItem
} from "@codemind/shared";
import { ContextApprovalError } from "./contextApprovalStore.js";
import type { ConversationStore } from "./conversationStore.js";
import { CredentialStoreError } from "./credentialStore.js";
import type { AIProviderManager } from "./providerManager.js";
import type { SecureTransmissionGate } from "./transmissionGate.js";
import type { AIUsageStore } from "./usageStore.js";

interface ActiveStreamEntry {
  requestId: string;
  provider: AIProviderName;
  controller: AbortController;
  cancelReason: string | null;
}

export type StreamEventEmitter = (event: AIStreamIpcEvent) => void;

/**
 * Main-process streaming orchestrator.
 * - Always enforces SecureTransmissionGate before any provider call.
 * - Isolates concurrent streams by requestId.
 * - Supports renderer cancellation and credential-change cancellation.
 * - Buffers & validates structured JSON responses before emitting stream:complete.
 * - Records privacy-safe usage metrics & optional local conversation history.
 */
export class AIStreamManager {
  private readonly activeStreams = new Map<string, ActiveStreamEntry>();
  private readonly transmissionGate: SecureTransmissionGate;
  private readonly providerManager: AIProviderManager;
  private readonly rateLimiter: AIRateLimiter;
  private readonly usageStore?: AIUsageStore;
  private readonly conversationStore?: ConversationStore;

  constructor(deps: {
    transmissionGate: SecureTransmissionGate;
    providerManager: AIProviderManager;
    rateLimiter?: AIRateLimiter;
    usageStore?: AIUsageStore;
    conversationStore?: ConversationStore;
  }) {
    this.transmissionGate = deps.transmissionGate;
    this.providerManager = deps.providerManager;
    this.rateLimiter = deps.rateLimiter ?? new AIRateLimiter(DESKTOP_RATE_LIMIT_CONFIG);
    this.usageStore = deps.usageStore;
    this.conversationStore = deps.conversationStore;
  }

  private emitSafe(emit: StreamEventEmitter, event: AIStreamIpcEvent): void {
    const validated = AIStreamIpcEventSchema.parse(event);
    emit(validated);
  }

  public startStream(
    params: {
      requestId?: string;
      workspaceRoot: string;
      snapshotId: string;
      modelId?: string;
      maxOutputTokens?: number;
      structured?: boolean;
      structuredKind?: StructuredResponseKind;
      conversationId?: string;
    },
    emit: StreamEventEmitter
  ): string {
    const requestId = params.requestId?.trim() || crypto.randomUUID();
    const startedAt = Date.now();
    const structured = Boolean(params.structured);

    // 1. Enforce SecureTransmissionGate synchronously BEFORE registering or calling provider
    const verified = this.transmissionGate.verifyAndPrepare({
      workspaceRoot: params.workspaceRoot,
      snapshotId: params.snapshotId,
      modelId: params.modelId,
      maxOutputTokens: params.maxOutputTokens
    });

    // 2. Enforce concurrency & sliding-window rate limits
    const releaseSlot = this.rateLimiter.acquire();

    // 3. Resolve provider (ensures encrypted credential exists & is decryptable)
    let providerInstance;
    try {
      providerInstance = this.providerManager.getProvider(verified.provider);
    } catch (err) {
      releaseSlot();
      throw err;
    }

    const controller = new AbortController();
    const activeEntry: ActiveStreamEntry = {
      requestId,
      provider: verified.provider,
      controller,
      cancelReason: null
    };
    this.activeStreams.set(requestId, activeEntry);

    const structuredKind = structured
      ? (params.structuredKind ?? resolveStructuredKindForTask(verified.snapshot.taskType))
      : undefined;

    const finalMessages: AIMessage[] = structuredKind
      ? verified.budget.messages.map((msg, idx) =>
          idx === 0 && msg.role === "system"
            ? {
                ...msg,
                content: `${msg.content}\n\nSTRUCTURED OUTPUT REQUIREMENT:\n${getStructuredInstructions(structuredKind)}`
              }
            : msg
        )
      : verified.budget.messages;

    // Persist user message if linked to a conversation
    if (params.conversationId && this.conversationStore) {
      try {
        this.conversationStore.appendMessage(
          verified.snapshot.workspaceRoot,
          params.conversationId,
          {
            role: "user",
            content: verified.snapshot.query,
            taskType: verified.snapshot.taskType,
            model: verified.modelId,
            provider: verified.provider,
            status: "completed",
            snapshotId: verified.snapshot.snapshotId,
            references: []
          }
        );
      } catch {
        // Non-fatal if conversation was deleted concurrently
      }
    }

    // Run stream asynchronously so startStream returns requestId immediately
    void (async () => {
      let accumulated = "";
      let reportedUsage: AIUsageMetrics | undefined;

      try {
        this.emitSafe(emit, {
          type: "stream:start",
          requestId,
          snapshotId: verified.snapshot.snapshotId,
          model: verified.modelId,
          provider: verified.provider,
          structured,
          timestamp: new Date().toISOString()
        });

        if (structured) {
          this.emitSafe(emit, {
            type: "stream:progress",
            requestId,
            stage: "streaming",
            message: "Receiving structured response...",
            timestamp: new Date().toISOString()
          });
        }

        const streamIter = providerInstance.stream({
          requestId,
          model: verified.modelId,
          messages: finalMessages,
          maxTokens: verified.budget.allocation.reservedOutputTokens,
          responseFormat: structured ? "json" : "text",
          signal: controller.signal
        });

        for await (const chunk of streamIter) {
          if (controller.signal.aborted) {
            break;
          }

          if (chunk.type === "delta") {
            accumulated += chunk.text;
            // For structured responses, do NOT stream raw unvalidated JSON as final display deltas
            if (!structured) {
              this.emitSafe(emit, {
                type: "stream:delta",
                requestId,
                text: chunk.text,
                timestamp: new Date().toISOString()
              });
            }
          } else if (chunk.type === "usage") {
            reportedUsage = chunk.usage;
            this.emitSafe(emit, {
              type: "stream:usage",
              requestId,
              usage: chunk.usage,
              timestamp: new Date().toISOString()
            });
          } else if (chunk.type === "done") {
            if (!accumulated && chunk.response.content) {
              accumulated = chunk.response.content;
            }
            if (chunk.response.usage) {
              reportedUsage = chunk.response.usage;
            }
          } else if (chunk.type === "error") {
            throw new AIProviderError("PROVIDER_ERROR", chunk.message, {
              provider: verified.provider,
              retryable: false
            });
          }
        }

        if (controller.signal.aborted) {
          const reason = activeEntry.cancelReason ?? "Cancelled by user.";
          this.emitSafe(emit, {
            type: "stream:cancelled",
            requestId,
            reason,
            timestamp: new Date().toISOString()
          });
          this.recordUsage(
            requestId,
            verified,
            "cancelled",
            "CANCELLED",
            Date.now() - startedAt,
            reportedUsage
          );
          return;
        }

        let structuredData: unknown;
        let verifiedReferences: VerifiedSourceReferenceItem[] | undefined;

        if (structured && structuredKind) {
          this.emitSafe(emit, {
            type: "stream:progress",
            requestId,
            stage: "validating",
            message: "Validating structured schema and source references...",
            timestamp: new Date().toISOString()
          });
          const validated = parseAndValidateStructuredResponse({
            rawContent: accumulated,
            kind: structuredKind,
            snapshot: verified.snapshot,
            provider: verified.provider
          });
          structuredData = validated.data;
          verifiedReferences = validated.verifiedReferences;
        }

        this.emitSafe(emit, {
          type: "stream:complete",
          requestId,
          snapshotId: verified.snapshot.snapshotId,
          content: accumulated,
          structuredKind,
          structuredData,
          verifiedReferences,
          model: verified.modelId,
          provider: verified.provider,
          usage: reportedUsage,
          budget: verified.budget.allocation,
          omittedFiles: verified.budget.omittedItems.map((o) => o.filePath),
          truncatedFiles: verified.budget.truncatedItems.map((t) => t.filePath),
          timestamp: new Date().toISOString()
        });

        this.recordUsage(
          requestId,
          verified,
          "success",
          null,
          Date.now() - startedAt,
          reportedUsage
        );

        if (params.conversationId && this.conversationStore) {
          try {
            this.conversationStore.appendMessage(
              verified.snapshot.workspaceRoot,
              params.conversationId,
              {
                role: "assistant",
                content: accumulated,
                taskType: verified.snapshot.taskType,
                model: verified.modelId,
                provider: verified.provider,
                status: "completed",
                snapshotId: verified.snapshot.snapshotId,
                references: verifiedReferences ?? [],
                usage: reportedUsage
              }
            );
          } catch {
            // Non-fatal
          }
        }
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) {
          const reason = activeEntry.cancelReason ?? "Cancelled by user.";
          this.emitSafe(emit, {
            type: "stream:cancelled",
            requestId,
            reason,
            timestamp: new Date().toISOString()
          });
          this.recordUsage(
            requestId,
            verified,
            "cancelled",
            "CANCELLED",
            Date.now() - startedAt,
            reportedUsage
          );
          return;
        }

        const safeError =
          err instanceof AIProviderError
            ? err
            : err instanceof ContextApprovalError || err instanceof CredentialStoreError
              ? new AIProviderError("INVALID_CONFIG", err.message, {
                  provider: verified.provider,
                  retryable: false
                })
              : normalizeProviderError(err, verified.provider);

        this.emitSafe(emit, {
          type: "stream:error",
          requestId,
          code: safeError.code,
          message: redactSecrets(safeError.message),
          retryable: safeError.retryable,
          timestamp: new Date().toISOString()
        });

        this.recordUsage(
          requestId,
          verified,
          "error",
          safeError.code,
          Date.now() - startedAt,
          reportedUsage
        );
      } finally {
        this.activeStreams.delete(requestId);
        releaseSlot();
      }
    })();

    return requestId;
  }

  public cancel(requestId: string, reason = "Cancelled by user."): boolean {
    const entry = this.activeStreams.get(requestId);
    if (!entry) {
      return false;
    }
    entry.cancelReason = reason;
    entry.controller.abort();
    return true;
  }

  public cancelAllForProvider(provider: AIProviderName, reason: string): number {
    let count = 0;
    for (const entry of this.activeStreams.values()) {
      if (entry.provider === provider) {
        entry.cancelReason = reason;
        entry.controller.abort();
        count += 1;
      }
    }
    return count;
  }

  public getActiveCount(): number {
    return this.activeStreams.size;
  }

  private recordUsage(
    requestId: string,
    verified: ReturnType<SecureTransmissionGate["verifyAndPrepare"]>,
    outcome: "success" | "error" | "cancelled",
    errorCategory: string | null,
    durationMs: number,
    usage?: AIUsageMetrics
  ): void {
    if (!this.usageStore) return;
    this.usageStore.record({
      requestId,
      provider: verified.provider,
      model: verified.modelId,
      taskType: verified.snapshot.taskType,
      outcome,
      errorCategory,
      retryCount: 0,
      durationMs,
      inputTokens: usage?.inputTokens ?? verified.budget.allocation.totalEstimatedInputTokens,
      outputTokens: usage?.outputTokens ?? 0,
      usageSource: usage ? "provider" : "estimated"
    });
  }
}
