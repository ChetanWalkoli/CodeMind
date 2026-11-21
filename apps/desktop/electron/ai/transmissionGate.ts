import crypto from "node:crypto";
import fs from "node:fs";
import {
  AIProviderError,
  budgetContextForModel,
  detectInlineSecrets,
  getModelConfig,
  redactSecrets,
  type BudgetedContextResult
} from "@codemind/ai-core";
import { CodeEngineIgnore } from "@codemind/code-engine";
import type { AIContextSnapshot, AIExecuteApprovedResult, AIProviderName } from "@codemind/shared";
import type { PreferencesStore } from "../utils/preferences.js";
import { WorkspaceSecurityError, type WorkspaceAuthority } from "../workspace/pathSecurity.js";
import { ContextApprovalError, type ContextApprovalStore } from "./contextApprovalStore.js";
import { isSensitiveContextFilePath } from "./contextBuilder.js";
import type { AIProviderManager } from "./providerManager.js";

export interface VerifiedTransmissionPackage {
  provider: AIProviderName;
  modelId: string;
  snapshot: AIContextSnapshot;
  budget: BudgetedContextResult;
}

/**
 * Main-process secure transmission gate.
 *
 * Enforces that NO source context can be transmitted to an AI provider unless:
 * 1. An explicit, unexpired approval record exists in the main-process ContextApprovalStore
 *    for the exact snapshotId and authorized workspaceRoot.
 * 2. Every included file is re-verified on disk for canonical path/symlink containment,
 *    secret/exclusion rules, inline secrets, and exact SHA-256 contentHash match.
 * 3. Token budgeting succeeds for the selected model without exceeding context limits.
 *
 * Any violation immediately revokes the snapshot approval and aborts BEFORE the provider
 * is ever invoked.
 */
export class SecureTransmissionGate {
  private readonly authority: WorkspaceAuthority;
  private readonly approvalStore: ContextApprovalStore;
  private readonly preferences: PreferencesStore;
  private readonly providerManager: AIProviderManager;

  constructor(deps: {
    authority: WorkspaceAuthority;
    approvalStore: ContextApprovalStore;
    preferences: PreferencesStore;
    providerManager: AIProviderManager;
  }) {
    this.authority = deps.authority;
    this.approvalStore = deps.approvalStore;
    this.preferences = deps.preferences;
    this.providerManager = deps.providerManager;
  }

  private revokeAndThrow(
    realRoot: string,
    snapshotId: string,
    code: string,
    message: string
  ): never {
    try {
      this.approvalStore.setApproval(realRoot, snapshotId, false);
    } catch {
      // Ignore if snapshot already removed
    }
    throw new ContextApprovalError(code, redactSecrets(message));
  }

  public verifyAndPrepare(params: {
    workspaceRoot: string;
    snapshotId: string;
    modelId?: string;
    maxOutputTokens?: number;
  }): VerifiedTransmissionPackage {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);

    // 1. Retrieve & enforce main-process approval (never trust renderer flags/snapshots)
    const approvedSnapshot = this.approvalStore.assertApproved(realRoot, params.snapshotId);

    // 2. Resolve model from catalog & preferences
    const aiPrefs = this.preferences.getAISettings();
    const targetModelId = params.modelId ?? aiPrefs.model;
    const modelConfig = getModelConfig(targetModelId);
    if (!modelConfig || modelConfig.provider !== aiPrefs.provider) {
      throw new AIProviderError(
        "INVALID_CONFIG",
        `Model "${targetModelId}" is not supported for provider "${aiPrefs.provider}".`,
        { provider: aiPrefs.provider, retryable: false }
      );
    }

    // 3. Re-verify every included file from disk immediately before transmission
    const customExcludes = this.preferences.getWorkspaceSession().customExcludes;
    const ignore = CodeEngineIgnore.fromWorkspace(realRoot, customExcludes);

    for (const item of approvedSnapshot.items) {
      // 3a. Re-check secret and exclusion rules
      if (isSensitiveContextFilePath(item.filePath)) {
        this.revokeAndThrow(
          realRoot,
          approvedSnapshot.snapshotId,
          "CONTEXT_SECRET_FILE_BLOCKED",
          `File "${item.filePath}" is classified as a secret file and cannot be transmitted. Rebuild and re-approve the context preview.`
        );
      }

      if (ignore.shouldIgnore(item.filePath, false)) {
        this.revokeAndThrow(
          realRoot,
          approvedSnapshot.snapshotId,
          "CONTEXT_EXCLUDED_AFTER_APPROVAL",
          `File "${item.filePath}" is now excluded by workspace ignore rules. Rebuild and re-approve the context preview.`
        );
      }

      // 3b. Re-verify canonical path & symlink target remain inside authorized workspace
      let canonicalPath: string;
      try {
        canonicalPath = this.authority.resolveSafePath(realRoot, item.filePath);
      } catch (err) {
        const msg =
          err instanceof WorkspaceSecurityError
            ? err.message
            : `File "${item.filePath}" failed workspace path containment verification.`;
        this.revokeAndThrow(
          realRoot,
          approvedSnapshot.snapshotId,
          "CONTEXT_PATH_SECURITY_VIOLATION",
          `${msg} Rebuild and re-approve the context preview.`
        );
      }

      // 3c. Re-read file from disk and verify exact SHA-256 content hash
      let rawBuffer: Buffer;
      try {
        const stat = fs.statSync(canonicalPath);
        if (!stat.isFile()) {
          this.revokeAndThrow(
            realRoot,
            approvedSnapshot.snapshotId,
            "CONTEXT_STALE_MODIFIED",
            `File "${item.filePath}" is no longer a regular file. Rebuild and re-approve the context preview.`
          );
        }
        rawBuffer = fs.readFileSync(canonicalPath);
      } catch (err) {
        if (err instanceof ContextApprovalError) throw err;
        this.revokeAndThrow(
          realRoot,
          approvedSnapshot.snapshotId,
          "CONTEXT_STALE_MODIFIED",
          `File "${item.filePath}" could not be read from disk and may have been deleted or moved. Rebuild and re-approve the context preview.`
        );
      }

      const currentHash = crypto.createHash("sha256").update(rawBuffer).digest("hex");
      if (currentHash !== item.contentHash) {
        this.revokeAndThrow(
          realRoot,
          approvedSnapshot.snapshotId,
          "CONTEXT_STALE_MODIFIED",
          `File "${item.filePath}" changed on disk after approval. Please rebuild and explicitly re-approve the context preview.`
        );
      }

      // 3d. Re-scan for inline secrets in otherwise normal source files
      const currentText = rawBuffer.toString("utf8");
      const secretMatches = detectInlineSecrets(currentText);
      if (secretMatches.length > 0) {
        this.revokeAndThrow(
          realRoot,
          approvedSnapshot.snapshotId,
          "INLINE_SECRET_DETECTED",
          `Potential inline secret (${secretMatches[0]!.description}) detected in "${item.filePath}" at line ${secretMatches[0]!.line}. Transmission blocked.`
        );
      }
    }

    // 4. Apply model-aware token budgeting
    const budget = budgetContextForModel(approvedSnapshot, {
      modelId: modelConfig.id,
      reservedOutputTokens: params.maxOutputTokens
    });

    // 5. Never silently omit or truncate context after user approval:
    // if the final budgeted items differ from the approved preview, require re-approval.
    const itemsChanged =
      budget.omittedItems.length > 0 ||
      budget.truncatedItems.length > 0 ||
      budget.snapshot.items.length !== approvedSnapshot.items.length ||
      budget.snapshot.items.some((item, idx) => {
        const orig = approvedSnapshot.items[idx];
        return (
          !orig ||
          item.filePath !== orig.filePath ||
          item.startLine !== orig.startLine ||
          item.endLine !== orig.endLine ||
          item.contentHash !== orig.contentHash
        );
      });

    if (itemsChanged) {
      const reasons: string[] = [];
      if (budget.omittedItems.length > 0) {
        reasons.push(`${budget.omittedItems.length} file(s) omitted`);
      }
      if (budget.truncatedItems.length > 0) {
        reasons.push(`${budget.truncatedItems.length} file(s) truncated`);
      }
      const detail = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
      this.revokeAndThrow(
        realRoot,
        approvedSnapshot.snapshotId,
        "CONTEXT_BUDGET_CHANGED",
        `Final budgeted context for model "${modelConfig.id}" differs from the approved preview${detail}. Please rebuild and explicitly re-approve the updated preview.`
      );
    }

    return {
      provider: aiPrefs.provider,
      modelId: modelConfig.id,
      snapshot: approvedSnapshot,
      budget
    };
  }

  public async executeApprovedContext(params: {
    workspaceRoot: string;
    snapshotId: string;
    modelId?: string;
    maxOutputTokens?: number;
    signal?: AbortSignal;
  }): Promise<AIExecuteApprovedResult> {
    // Gate executes synchronously BEFORE resolving provider or making any network call
    const verified = this.verifyAndPrepare({
      workspaceRoot: params.workspaceRoot,
      snapshotId: params.snapshotId,
      modelId: params.modelId,
      maxOutputTokens: params.maxOutputTokens
    });

    const provider = this.providerManager.getProvider(verified.provider);
    const response = await provider.generate({
      model: verified.modelId,
      messages: verified.budget.messages,
      maxTokens: verified.budget.allocation.reservedOutputTokens,
      signal: params.signal
    });

    return {
      snapshotId: verified.snapshot.snapshotId,
      model: response.model,
      provider: response.provider,
      content: response.content,
      usage: response.usage,
      budget: verified.budget.allocation,
      omittedFiles: verified.budget.omittedItems.map((o) => o.filePath),
      truncatedFiles: verified.budget.truncatedItems.map((t) => t.filePath)
    };
  }
}
