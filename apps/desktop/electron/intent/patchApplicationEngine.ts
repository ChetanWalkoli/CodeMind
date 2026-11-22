import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeContentSha256, detectInlineSecrets } from "@codemind/ai-core";
import { CodeEngineIgnore } from "@codemind/code-engine";
import {
  PatchApprovalRecordSchema,
  PatchTransactionRecordSchema,
  type IntentPatchProposal,
  type IntentSession,
  type PatchApprovalEntry,
  type PatchApprovalRecord,
  type PatchFileSnapshotMeta,
  type PatchTransactionFileResult,
  type PatchTransactionRecord
} from "@codemind/shared";
import { isSensitiveContextFilePath } from "../ai/contextBuilder.js";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";
import type { IntentStore } from "./intentStore.js";

const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class PatchApplicationError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PatchApplicationError";
    this.code = code;
  }
}

export type AtomicWriteFileFn = (targetAbsPath: string, content: string, mode?: number) => void;

function defaultAtomicWrite(targetAbsPath: string, content: string, mode?: number): void {
  const dir = path.dirname(targetAbsPath);
  const tmpPath = path.join(dir, `.codemind-patch-${crypto.randomBytes(6).toString("hex")}.tmp`);
  fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode });
  try {
    fs.renameSync(tmpPath, targetAbsPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

/**
 * Approval Manager & Safe Patch Application Engine (Milestone 6.7).
 *
 * Security invariants enforced in the main process:
 * 1. Explicit transaction approval bound to exact patchIds, versions, and SHA-256 hashes.
 * 2. Recommendation approval or diff review acceptance alone is NEVER sufficient to write files.
 * 3. Every target file is revalidated on disk (WorkspaceAuthority, symlinks, secret rules,
 *    ignore rules, exact original SHA-256 hash) immediately before writing.
 * 4. Pre-change snapshots are persisted BEFORE any workspace file is modified.
 * 5. If any file write fails mid-transaction, already-written files are automatically
 *    recovered from snapshots (or marked `needs_recovery` if recovery itself fails).
 * 6. Prevents concurrent active transactions and duplicate application of an approval.
 */
export class PatchApplicationEngine {
  private readonly authority: WorkspaceAuthority;
  private readonly store: IntentStore;
  private readonly writeFileAtomic: AtomicWriteFileFn;
  private readonly activeWorkspaces = new Set<string>();
  private readonly consumedApprovals = new Set<string>();

  constructor(deps: {
    authority: WorkspaceAuthority;
    store: IntentStore;
    writeFileAtomic?: AtomicWriteFileFn;
  }) {
    this.authority = deps.authority;
    this.store = deps.store;
    this.writeFileAtomic = deps.writeFileAtomic ?? defaultAtomicWrite;
  }

  public createApproval(params: {
    authorizedRoot: string;
    session: IntentSession;
    entries: PatchApprovalEntry[];
    approved: boolean;
  }): PatchApprovalRecord {
    const { authorizedRoot, session, entries, approved } = params;

    // Verify every entry matches an existing, valid, review-accepted patch in the session
    const seenTargets = new Set<string>();
    for (const entry of entries) {
      if (seenTargets.has(entry.targetFile)) {
        throw new PatchApplicationError(
          "PATCH_DUPLICATE_TARGET",
          `Duplicate target file "${entry.targetFile}" in approval transaction.`
        );
      }
      seenTargets.add(entry.targetFile);

      const patch = session.patches.find((p) => p.patchId === entry.patchId);
      if (!patch) {
        throw new PatchApplicationError(
          "PATCH_NOT_FOUND",
          `Patch "${entry.patchId}" does not exist in this intent session.`
        );
      }
      if (!patch.validation.valid) {
        throw new PatchApplicationError(
          "PATCH_INVALID",
          `Patch "${entry.patchId}" failed validation and cannot be approved.`
        );
      }
      if (patch.reviewDecision !== "accepted") {
        throw new PatchApplicationError(
          "PATCH_NOT_ACCEPTED_IN_REVIEW",
          `Patch "${entry.patchId}" must be accepted in Diff Review before transaction approval.`
        );
      }
      if (
        patch.targetFile !== entry.targetFile ||
        patch.originalFileHash !== entry.originalFileHash ||
        patch.proposedFileHash !== entry.proposedFileHash ||
        patch.originalContentVersion !== entry.originalContentVersion
      ) {
        throw new PatchApplicationError(
          "PATCH_APPROVAL_MISMATCH",
          `Approval entry for "${entry.targetFile}" does not match exact patch hashes or version.`
        );
      }
    }

    const now = Date.now();
    return PatchApprovalRecordSchema.parse({
      approvalId: `appr-${crypto.randomUUID().slice(0, 12)}`,
      intentId: session.intent.intentId,
      workspaceRoot: authorizedRoot,
      entries,
      approved,
      approvedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DEFAULT_APPROVAL_TTL_MS).toISOString()
    });
  }

  public applyApprovedTransaction(params: {
    authorizedRoot: string;
    session: IntentSession;
    approvalId: string;
    customExcludes?: string[];
  }): PatchTransactionRecord {
    const { authorizedRoot, session, approvalId } = params;

    if (this.activeWorkspaces.has(authorizedRoot)) {
      throw new PatchApplicationError(
        "PATCH_CONCURRENT_TX_BLOCKED",
        "Another patch transaction is already active for this workspace."
      );
    }

    if (this.consumedApprovals.has(approvalId)) {
      throw new PatchApplicationError(
        "PATCH_APPROVAL_ALREADY_USED",
        `Approval "${approvalId}" has already been applied.`
      );
    }

    const alreadyApplied = session.transactions.some(
      (tx) => tx.approvalId === approvalId && tx.status === "applied"
    );
    if (alreadyApplied) {
      throw new PatchApplicationError(
        "PATCH_APPROVAL_ALREADY_USED",
        `Approval "${approvalId}" has already been applied.`
      );
    }

    const approval = session.approvals.find((a) => a.approvalId === approvalId);
    if (!approval || !approval.approved) {
      throw new PatchApplicationError(
        "PATCH_APPROVAL_REQUIRED",
        "Explicit transaction approval is required before applying patches."
      );
    }

    if (approval.workspaceRoot !== authorizedRoot) {
      throw new PatchApplicationError(
        "PATCH_WORKSPACE_MISMATCH",
        "Approval record does not belong to the authorized workspace."
      );
    }

    if (Date.now() > Date.parse(approval.expiresAt)) {
      throw new PatchApplicationError(
        "PATCH_APPROVAL_EXPIRED",
        "Patch approval has expired. Please review and approve again."
      );
    }

    this.activeWorkspaces.add(authorizedRoot);
    const transactionId = `tx-${crypto.randomUUID().slice(0, 12)}`;
    const createdAt = new Date().toISOString();

    try {
      const ignore = CodeEngineIgnore.fromWorkspace(authorizedRoot, params.customExcludes ?? []);

      // Phase 1: Revalidate EVERY target file on disk BEFORE writing a single byte
      const prepared: Array<{
        patch: IntentPatchProposal;
        canonicalPath: string;
        originalBuffer: Buffer;
        fileMode: number;
      }> = [];

      for (const entry of approval.entries) {
        const patch = session.patches.find((p) => p.patchId === entry.patchId);
        if (!patch || !patch.validation.valid || patch.reviewDecision !== "accepted") {
          throw new PatchApplicationError(
            "PATCH_INVALID_STATE",
            `Patch "${entry.patchId}" is no longer valid or accepted.`
          );
        }

        if (isSensitiveContextFilePath(patch.targetFile)) {
          throw new PatchApplicationError(
            "PATCH_SECRET_FILE_BLOCKED",
            `File "${patch.targetFile}" is a secret file and cannot be modified.`
          );
        }

        if (ignore.shouldIgnore(patch.targetFile, false)) {
          throw new PatchApplicationError(
            "PATCH_EXCLUDED_FILE_BLOCKED",
            `File "${patch.targetFile}" is excluded by workspace ignore rules.`
          );
        }

        const canonicalPath = this.authority.resolveSafePath(authorizedRoot, patch.targetFile);
        const stat = fs.statSync(canonicalPath);
        if (!stat.isFile()) {
          throw new PatchApplicationError(
            "PATCH_NOT_A_FILE",
            `Target "${patch.targetFile}" is not a regular file.`
          );
        }

        const originalBuffer = fs.readFileSync(canonicalPath);
        const currentHash = computeContentSha256(originalBuffer);
        if (currentHash !== entry.originalFileHash || currentHash !== patch.originalFileHash) {
          throw new PatchApplicationError(
            "PATCH_STALE_FILE_MODIFIED",
            `File "${patch.targetFile}" changed on disk after review (expected hash ${entry.originalFileHash.slice(0, 10)}, found ${currentHash.slice(0, 10)}). Re-review is required.`
          );
        }

        if (detectInlineSecrets(patch.proposedContent).length > 0) {
          throw new PatchApplicationError(
            "PATCH_PROPOSED_SECRET_BLOCKED",
            `Proposed content for "${patch.targetFile}" contains a potential secret.`
          );
        }

        prepared.push({
          patch,
          canonicalPath,
          originalBuffer,
          fileMode: stat.mode
        });
      }

      // Phase 2: Persist pre-change recovery snapshots for ALL files before any write
      const snapshots: PatchFileSnapshotMeta[] = [];
      for (const item of prepared) {
        const snap = this.store.writeRecoverySnapshot(
          transactionId,
          item.patch.targetFile,
          item.originalBuffer
        );
        snapshots.push({
          targetFile: item.patch.targetFile,
          originalFileHash: item.patch.originalFileHash,
          appliedFileHash: item.patch.proposedFileHash,
          snapshotFileName: snap.snapshotFileName,
          snapshotHash: snap.snapshotHash,
          fileMode: item.fileMode
        });
      }

      // Phase 3: Apply file writes sequentially with automatic rollback on mid-transaction failure
      const fileResults: PatchTransactionFileResult[] = [];
      const writtenItems: typeof prepared = [];
      let writeError: string | null = null;

      for (const item of prepared) {
        try {
          this.writeFileAtomic(item.canonicalPath, item.patch.proposedContent, item.fileMode);
          writtenItems.push(item);
          fileResults.push({
            patchId: item.patch.patchId,
            targetFile: item.patch.targetFile,
            status: "applied",
            addedLines: item.patch.addedLines,
            removedLines: item.patch.removedLines,
            originalFileHash: item.patch.originalFileHash,
            appliedFileHash: item.patch.proposedFileHash,
            error: null
          });
        } catch (err) {
          writeError = err instanceof Error ? err.message : "Failed to write file.";
          fileResults.push({
            patchId: item.patch.patchId,
            targetFile: item.patch.targetFile,
            status: "failed",
            addedLines: item.patch.addedLines,
            removedLines: item.patch.removedLines,
            originalFileHash: item.patch.originalFileHash,
            appliedFileHash: null,
            error: writeError
          });
          break;
        }
      }

      // If any write failed after earlier writes succeeded, immediately recover written files!
      if (writeError !== null) {
        let allRecovered = true;
        for (const written of writtenItems.reverse()) {
          try {
            defaultAtomicWrite(
              written.canonicalPath,
              written.originalBuffer.toString("utf8"),
              written.fileMode
            );
            const resEntry = fileResults.find((r) => r.patchId === written.patch.patchId);
            if (resEntry) {
              resEntry.status = "recovered";
              resEntry.appliedFileHash = null;
            }
          } catch {
            allRecovered = false;
          }
        }

        // Mark remaining untouched files as skipped
        for (const item of prepared) {
          if (!fileResults.some((r) => r.patchId === item.patch.patchId)) {
            fileResults.push({
              patchId: item.patch.patchId,
              targetFile: item.patch.targetFile,
              status: "skipped",
              addedLines: item.patch.addedLines,
              removedLines: item.patch.removedLines,
              originalFileHash: item.patch.originalFileHash,
              appliedFileHash: null,
              error: "Skipped due to earlier write failure in transaction."
            });
          }
        }

        const status =
          writtenItems.length === 0 ? "failed" : allRecovered ? "recovered" : "needs_recovery";

        return PatchTransactionRecordSchema.parse({
          transactionId,
          intentId: session.intent.intentId,
          approvalId,
          workspaceRoot: authorizedRoot,
          status,
          files: fileResults,
          snapshots,
          errorSummary: allRecovered
            ? `Write failed (${writeError}); all previously modified files were automatically recovered.`
            : `Write failed (${writeError}) and automatic recovery was incomplete. Manual recovery required.`,
          createdAt,
          completedAt: new Date().toISOString()
        });
      }

      this.consumedApprovals.add(approvalId);
      return PatchTransactionRecordSchema.parse({
        transactionId,
        intentId: session.intent.intentId,
        approvalId,
        workspaceRoot: authorizedRoot,
        status: "applied",
        files: fileResults,
        snapshots,
        errorSummary: null,
        createdAt,
        completedAt: new Date().toISOString()
      });
    } finally {
      this.activeWorkspaces.delete(authorizedRoot);
    }
  }
}
