import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeContentSha256 } from "@codemind/ai-core";
import {
  RollbackCheckResultSchema,
  RollbackRecordSchema,
  type IntentSession,
  type PatchTransactionRecord,
  type RollbackCheckResult,
  type RollbackConflict,
  type RollbackFileOutcome,
  type RollbackMode,
  type RollbackRecord
} from "@codemind/shared";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";
import type { IntentStore } from "./intentStore.js";

export class RollbackSecurityError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RollbackSecurityError";
    this.code = code;
  }
}

function atomicRestoreBuffer(targetAbsPath: string, content: Buffer, mode?: number): void {
  const dir = path.dirname(targetAbsPath);
  const tmpPath = path.join(dir, `.codemind-rollback-${crypto.randomBytes(6).toString("hex")}.tmp`);
  fs.writeFileSync(tmpPath, content, { mode });
  try {
    fs.renameSync(tmpPath, targetAbsPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Rollback & Recovery Manager (Milestone 6.9).
 *
 * Safeguards enforced in the main process:
 * 1. Validates workspace authorization and transaction ownership.
 * 2. Verifies pre-change backup existence and SHA-256 integrity before restoring.
 * 3. Detects post-patch modifications (`modified_after_patch`) and refuses to overwrite
 *    newer user edits unless `forceOverwriteModified: true` is explicitly confirmed.
 * 4. Supports single-file rollback, full-transaction rollback, and partial-recovery.
 * 5. Idempotent: files already matching their original pre-patch hash are reported as `already_original`.
 * 6. Preserves recovery snapshots so repeated checks/rollbacks remain safe.
 */
export class RecoveryManager {
  private readonly authority: WorkspaceAuthority;
  private readonly store: IntentStore;

  constructor(deps: { authority: WorkspaceAuthority; store: IntentStore }) {
    this.authority = deps.authority;
    this.store = deps.store;
  }

  private getAuthorizedTransaction(
    authorizedRoot: string,
    session: IntentSession,
    transactionId: string
  ): PatchTransactionRecord {
    const tx = session.transactions.find((t) => t.transactionId === transactionId);
    if (!tx) {
      throw new RollbackSecurityError(
        "ROLLBACK_TX_NOT_FOUND",
        `Transaction "${transactionId}" was not found in this intent session.`
      );
    }
    if (tx.workspaceRoot !== authorizedRoot) {
      throw new RollbackSecurityError(
        "ROLLBACK_UNAUTHORIZED_WORKSPACE",
        "Transaction does not belong to the authorized workspace."
      );
    }
    return tx;
  }

  public checkRollback(params: {
    authorizedRoot: string;
    session: IntentSession;
    transactionId: string;
    targetFiles?: string[];
  }): RollbackCheckResult {
    const tx = this.getAuthorizedTransaction(
      params.authorizedRoot,
      params.session,
      params.transactionId
    );
    const filterSet = params.targetFiles ? new Set(params.targetFiles) : null;
    const snapshots = filterSet
      ? tx.snapshots.filter((s) => filterSet.has(s.targetFile))
      : tx.snapshots;

    const conflicts: RollbackConflict[] = [];
    const eligibleFiles: string[] = [];

    for (const snap of snapshots) {
      const backupBuffer = this.store.readRecoverySnapshot(tx.transactionId, snap.snapshotFileName);
      if (!backupBuffer) {
        conflicts.push({
          targetFile: snap.targetFile,
          reason: "missing_backup",
          message: `Recovery backup for "${snap.targetFile}" is missing.`,
          expectedAppliedHash: snap.appliedFileHash,
          currentDiskHash: null
        });
        continue;
      }

      const backupHash = computeContentSha256(backupBuffer);
      if (backupHash !== snap.snapshotHash || backupHash !== snap.originalFileHash) {
        conflicts.push({
          targetFile: snap.targetFile,
          reason: "corrupted_backup",
          message: `Recovery backup for "${snap.targetFile}" failed SHA-256 integrity verification.`,
          expectedAppliedHash: snap.appliedFileHash,
          currentDiskHash: null
        });
        continue;
      }

      let currentDiskHash: string | null = null;
      try {
        const abs = this.authority.resolveSafePath(params.authorizedRoot, snap.targetFile);
        if (!fs.existsSync(abs)) {
          conflicts.push({
            targetFile: snap.targetFile,
            reason: "file_deleted",
            message: `File "${snap.targetFile}" was deleted after patch application.`,
            expectedAppliedHash: snap.appliedFileHash,
            currentDiskHash: null
          });
          continue;
        }
        currentDiskHash = computeContentSha256(fs.readFileSync(abs));
      } catch {
        conflicts.push({
          targetFile: snap.targetFile,
          reason: "file_deleted",
          message: `File "${snap.targetFile}" could not be safely resolved inside workspace.`,
          expectedAppliedHash: snap.appliedFileHash,
          currentDiskHash: null
        });
        continue;
      }

      if (currentDiskHash !== snap.appliedFileHash && currentDiskHash !== snap.originalFileHash) {
        conflicts.push({
          targetFile: snap.targetFile,
          reason: "modified_after_patch",
          message: `File "${snap.targetFile}" has been modified after patch application. Explicit overwrite confirmation is required.`,
          expectedAppliedHash: snap.appliedFileHash,
          currentDiskHash
        });
        continue;
      }

      eligibleFiles.push(snap.targetFile);
    }

    return RollbackCheckResultSchema.parse({
      transactionId: tx.transactionId,
      canRollbackCleanly: conflicts.length === 0,
      conflicts,
      eligibleFiles
    });
  }

  public executeRollback(params: {
    authorizedRoot: string;
    session: IntentSession;
    transactionId: string;
    mode: RollbackMode;
    targetFiles?: string[];
    confirmedByUser: boolean;
    forceOverwriteModified?: boolean;
  }): RollbackRecord {
    if (!params.confirmedByUser) {
      throw new RollbackSecurityError(
        "ROLLBACK_CONFIRMATION_REQUIRED",
        "Explicit user confirmation is required before rolling back files."
      );
    }

    const tx = this.getAuthorizedTransaction(
      params.authorizedRoot,
      params.session,
      params.transactionId
    );
    const filterSet =
      params.mode === "single-file" && params.targetFiles && params.targetFiles.length > 0
        ? new Set(params.targetFiles)
        : null;
    const snapshots = filterSet
      ? tx.snapshots.filter((s) => filterSet.has(s.targetFile))
      : tx.snapshots;

    if (snapshots.length === 0) {
      throw new RollbackSecurityError(
        "ROLLBACK_NO_TARGETS",
        "No matching snapshot targets found for rollback."
      );
    }

    const outcomes: RollbackFileOutcome[] = [];
    let anyRestoredOrOriginal = false;
    let anyConflictOrFailure = false;

    for (const snap of snapshots) {
      const backupBuffer = this.store.readRecoverySnapshot(tx.transactionId, snap.snapshotFileName);
      if (!backupBuffer) {
        anyConflictOrFailure = true;
        outcomes.push({
          targetFile: snap.targetFile,
          status: "failed",
          message: "Recovery backup file is missing."
        });
        continue;
      }

      const backupHash = computeContentSha256(backupBuffer);
      if (backupHash !== snap.snapshotHash || backupHash !== snap.originalFileHash) {
        anyConflictOrFailure = true;
        outcomes.push({
          targetFile: snap.targetFile,
          status: "failed",
          message:
            "Recovery backup failed SHA-256 integrity check; refused to restore corrupted backup."
        });
        continue;
      }

      let absPath: string;
      try {
        absPath = this.authority.resolveSafePath(params.authorizedRoot, snap.targetFile);
      } catch (err) {
        anyConflictOrFailure = true;
        outcomes.push({
          targetFile: snap.targetFile,
          status: "failed",
          message: err instanceof Error ? err.message : "Unauthorized rollback path."
        });
        continue;
      }

      let currentHash: string | null = null;
      if (fs.existsSync(absPath)) {
        currentHash = computeContentSha256(fs.readFileSync(absPath));
      }

      // Idempotent check: already at original pre-patch state
      if (currentHash === snap.originalFileHash) {
        anyRestoredOrOriginal = true;
        outcomes.push({
          targetFile: snap.targetFile,
          status: "already_original",
          message: "File already matches the original pre-patch snapshot."
        });
        continue;
      }

      // Guard newer user edits unless forceOverwriteModified is explicitly confirmed
      if (
        currentHash !== null &&
        currentHash !== snap.appliedFileHash &&
        !params.forceOverwriteModified
      ) {
        anyConflictOrFailure = true;
        outcomes.push({
          targetFile: snap.targetFile,
          status: "skipped_conflict",
          message:
            "File was modified after patch application; preserved current content (confirm force overwrite to restore)."
        });
        continue;
      }

      try {
        atomicRestoreBuffer(absPath, backupBuffer, snap.fileMode);
        anyRestoredOrOriginal = true;
        outcomes.push({
          targetFile: snap.targetFile,
          status: "restored",
          message: "Restored original pre-patch snapshot."
        });
      } catch (err) {
        anyConflictOrFailure = true;
        outcomes.push({
          targetFile: snap.targetFile,
          status: "failed",
          message: err instanceof Error ? err.message : "Failed to restore file."
        });
      }
    }

    const status: RollbackRecord["status"] = !anyConflictOrFailure
      ? "completed"
      : anyRestoredOrOriginal
        ? "partial"
        : "failed";

    return RollbackRecordSchema.parse({
      rollbackId: `rb-${crypto.randomUUID().slice(0, 12)}`,
      intentId: params.session.intent.intentId,
      transactionId: tx.transactionId,
      mode: params.mode,
      forcedOverwrite: Boolean(params.forceOverwriteModified),
      status,
      files: outcomes,
      createdAt: new Date().toISOString()
    });
  }
}
