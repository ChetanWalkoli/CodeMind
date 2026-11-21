import type { AIContextApprovalRecord, AIContextSnapshot } from "@codemind/shared";

export class ContextApprovalError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ContextApprovalError";
    this.code = code;
  }
}

interface StoredSnapshotEntry {
  snapshot: AIContextSnapshot;
  approved: boolean;
  approvedAt: string | null;
  expiresAtMs: number | null;
}

const MAX_STORED_SNAPSHOTS = 30;
const DEFAULT_APPROVAL_TTL_MS = 30 * 60 * 1000;

function normalizePosix(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Main-process approval registry binding explicit developer approval to an exact
 * immutable AIContextSnapshot (identified by its SHA-256 snapshotId).
 *
 * Any change to query, file selection, or underlying file content invalidates approval.
 */
export class ContextApprovalStore {
  private readonly entries = new Map<string, StoredSnapshotEntry>();
  private readonly approvalTtlMs: number;

  constructor(approvalTtlMs = DEFAULT_APPROVAL_TTL_MS) {
    this.approvalTtlMs = approvalTtlMs;
  }

  public registerSnapshot(snapshot: AIContextSnapshot): void {
    // Re-registering an identical snapshotId preserves existing approval only if not expired;
    // any changed snapshot has a different SHA-256 snapshotId and starts unapproved.
    if (!this.entries.has(snapshot.snapshotId)) {
      this.entries.set(snapshot.snapshotId, {
        snapshot,
        approved: false,
        approvedAt: null,
        expiresAtMs: null
      });
    }

    // Evict oldest entries beyond bounded capacity
    while (this.entries.size > MAX_STORED_SNAPSHOTS) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  public setApproval(
    workspaceRoot: string,
    snapshotId: string,
    approved: boolean
  ): AIContextApprovalRecord {
    const entry = this.entries.get(snapshotId);
    if (!entry || entry.snapshot.workspaceRoot !== workspaceRoot) {
      throw new ContextApprovalError(
        "CONTEXT_SNAPSHOT_NOT_FOUND",
        "Context snapshot not found for this workspace. Please rebuild the context preview."
      );
    }

    if (approved) {
      const now = Date.now();
      entry.approved = true;
      entry.approvedAt = new Date(now).toISOString();
      entry.expiresAtMs = now + this.approvalTtlMs;
    } else {
      entry.approved = false;
      entry.approvedAt = null;
      entry.expiresAtMs = null;
    }

    return this.toRecord(snapshotId, entry);
  }

  public getApproval(workspaceRoot: string, snapshotId: string): AIContextApprovalRecord {
    const entry = this.entries.get(snapshotId);
    if (!entry || entry.snapshot.workspaceRoot !== workspaceRoot) {
      return {
        snapshotId,
        approved: false,
        approvedAt: null,
        expiresAt: null
      };
    }

    if (entry.approved && entry.expiresAtMs !== null && Date.now() > entry.expiresAtMs) {
      entry.approved = false;
      entry.approvedAt = null;
      entry.expiresAtMs = null;
    }

    return this.toRecord(snapshotId, entry);
  }

  /**
   * Transmission gate: verifies that an exact snapshotId is registered for the workspace,
   * explicitly approved by the user, and not expired or invalidated.
   */
  public assertApproved(workspaceRoot: string, snapshotId: string): AIContextSnapshot {
    const entry = this.entries.get(snapshotId);
    if (!entry || entry.snapshot.workspaceRoot !== workspaceRoot) {
      throw new ContextApprovalError(
        "CONTEXT_SNAPSHOT_NOT_FOUND",
        "Context snapshot not found or no longer valid. Rebuild and approve a fresh preview."
      );
    }

    if (!entry.approved) {
      throw new ContextApprovalError(
        "CONTEXT_NOT_APPROVED",
        "Explicit user approval is required before transmitting source context to an AI provider."
      );
    }

    if (entry.expiresAtMs !== null && Date.now() > entry.expiresAtMs) {
      entry.approved = false;
      entry.approvedAt = null;
      entry.expiresAtMs = null;
      throw new ContextApprovalError(
        "CONTEXT_APPROVAL_EXPIRED",
        "Context approval has expired. Please review and re-approve the context snapshot."
      );
    }

    return entry.snapshot;
  }

  /**
   * Invalidates any approved snapshots in the workspace that included a modified file.
   */
  public invalidateForFile(workspaceRoot: string, relativePath: string): number {
    const target = normalizePosix(relativePath);
    let invalidated = 0;

    for (const entry of this.entries.values()) {
      if (entry.snapshot.workspaceRoot !== workspaceRoot) continue;
      if (!entry.approved) continue;

      const includesFile = entry.snapshot.items.some((item) => item.filePath === target);
      if (includesFile) {
        entry.approved = false;
        entry.approvedAt = null;
        entry.expiresAtMs = null;
        invalidated += 1;
      }
    }

    return invalidated;
  }

  private toRecord(snapshotId: string, entry: StoredSnapshotEntry): AIContextApprovalRecord {
    return {
      snapshotId,
      approved: entry.approved,
      approvedAt: entry.approvedAt,
      expiresAt: entry.expiresAtMs !== null ? new Date(entry.expiresAtMs).toISOString() : null
    };
  }
}
