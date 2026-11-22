import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeContentSha256, computeDecisionVerificationState } from "@codemind/ai-core";
import { CodeEngineIgnore, type ProjectIndexer } from "@codemind/code-engine";
import {
  DecisionEvidenceSchema,
  type DecisionEvidence,
  type DecisionEvidenceInput,
  type EngineeringDecision
} from "@codemind/shared";
import { isSensitiveContextFilePath } from "../ai/contextBuilder.js";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";

export class DecisionEvidenceError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DecisionEvidenceError";
    this.code = code;
  }
}

function isUnsafePath(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("\0")) return true;
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) {
    return true;
  }
  return trimmed
    .replace(/\\/g, "/")
    .split("/")
    .some((s) => s === "..");
}

/**
 * Evidence Linking & Freshness Verification Service (Milestones 7.3 & 7.9).
 * Reuses WorkspaceAuthority, CodeEngineIgnore, secret exclusion, and ProjectIndexer.
 * Never copies full source files into decision records; stores validated paths,
 * line ranges, symbol names, and SHA-256 content hashes.
 */
export class DecisionEvidenceService {
  private readonly authority: WorkspaceAuthority;

  constructor(authority: WorkspaceAuthority) {
    this.authority = authority;
  }

  public createValidatedEvidence(params: {
    authorizedRoot: string;
    input: DecisionEvidenceInput;
    indexer?: ProjectIndexer;
    customExcludes?: string[];
  }): DecisionEvidence {
    const { authorizedRoot, input, indexer } = params;
    const now = new Date().toISOString();
    const id = `ev-${crypto.randomUUID().slice(0, 12)}`;

    const isFileBacked =
      input.type === "source_file" ||
      input.type === "symbol" ||
      input.type === "code_range" ||
      input.type === "test";

    if (!isFileBacked) {
      return DecisionEvidenceSchema.parse({
        id,
        type: input.type,
        commitSha: input.commitSha,
        description: input.description,
        verificationStatus: input.type === "git_commit" ? "current" : "unverified",
        provenance: input.type === "developer_statement" ? "developer_stated" : "verified",
        timestamp: now,
        staleReason: null,
        isHistorical: false
      });
    }

    if (!input.filePath || isUnsafePath(input.filePath)) {
      throw new DecisionEvidenceError(
        "DECISION_INVALID_EVIDENCE_PATH",
        `Evidence file path "${input.filePath ?? ""}" is invalid or attempts path traversal.`
      );
    }

    const posixPath = input.filePath.replace(/\\/g, "/").replace(/^\/+/, "");

    if (isSensitiveContextFilePath(posixPath)) {
      throw new DecisionEvidenceError(
        "DECISION_SECRET_FILE_BLOCKED",
        `Secret or sensitive file "${posixPath}" cannot be linked as decision evidence.`
      );
    }

    const ignore = CodeEngineIgnore.fromWorkspace(authorizedRoot, params.customExcludes ?? []);
    if (ignore.shouldIgnore(posixPath, false)) {
      throw new DecisionEvidenceError(
        "DECISION_IGNORED_FILE_BLOCKED",
        `Ignored file "${posixPath}" cannot be linked as decision evidence.`
      );
    }

    const absPath = this.authority.resolveSafePath(authorizedRoot, posixPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      throw new DecisionEvidenceError(
        "DECISION_EVIDENCE_FILE_NOT_FOUND",
        `Evidence file "${posixPath}" does not exist inside the authorized workspace.`
      );
    }

    const rawBuf = fs.readFileSync(absPath);
    const contentHash = computeContentSha256(rawBuf);
    const lineCount = Math.max(1, rawBuf.toString("utf8").split(/\r?\n/).length);

    if (input.startLine !== undefined) {
      const endLine = input.endLine ?? input.startLine;
      if (input.startLine < 1 || endLine < input.startLine || endLine > lineCount) {
        throw new DecisionEvidenceError(
          "DECISION_INVALID_LINE_RANGE",
          `Line range ${input.startLine}-${endLine} is out of bounds for "${posixPath}" (${lineCount} lines).`
        );
      }
    }

    // Optional symbol check against ProjectIndexer when available
    let staleReason: string | null = null;
    if (input.symbolName && indexer) {
      const syms = indexer.getFileSymbols(posixPath);
      if (syms.length > 0 && !syms.some((s) => s.name === input.symbolName)) {
        staleReason = `Symbol "${input.symbolName}" was not found in "${posixPath}".`;
      }
    }

    return DecisionEvidenceSchema.parse({
      id,
      type: input.type,
      filePath: posixPath,
      symbolName: input.symbolName,
      startLine: input.startLine,
      endLine: input.endLine ?? input.startLine,
      contentHash,
      description: input.description,
      verificationStatus: staleReason ? "needs_review" : "current",
      provenance: staleReason ? "inferred" : "verified",
      timestamp: now,
      staleReason,
      isHistorical: false
    });
  }

  /**
   * Re-checks all active (non-historical) evidence items on a decision against current disk state.
   * Preserves historical reasoning and marks modified/deleted/out-of-bounds evidence as stale.
   */
  public verifyDecisionEvidence(params: {
    authorizedRoot: string;
    decision: EngineeringDecision;
    indexer?: ProjectIndexer;
  }): { decision: EngineeringDecision; newlyStaleCount: number } {
    const { authorizedRoot, decision, indexer } = params;
    let newlyStaleCount = 0;

    const updatedEvidence = decision.evidence.map((item) => {
      if (item.isHistorical || !item.filePath) {
        return item;
      }

      const wasStale = item.verificationStatus === "stale";
      let absPath: string;
      try {
        absPath = this.authority.resolveSafePath(authorizedRoot, item.filePath);
      } catch {
        if (!wasStale) newlyStaleCount += 1;
        return {
          ...item,
          verificationStatus: "stale" as const,
          provenance: "stale" as const,
          staleReason: "Evidence file is no longer inside the authorized workspace."
        };
      }

      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        if (!wasStale) newlyStaleCount += 1;
        return {
          ...item,
          verificationStatus: "stale" as const,
          provenance: "stale" as const,
          staleReason: `Linked file "${item.filePath}" was deleted or moved.`
        };
      }

      const rawBuf = fs.readFileSync(absPath);
      const currentHash = computeContentSha256(rawBuf);
      const lineCount = Math.max(1, rawBuf.toString("utf8").split(/\r?\n/).length);

      if (item.contentHash && currentHash !== item.contentHash) {
        if (!wasStale) newlyStaleCount += 1;
        return {
          ...item,
          verificationStatus: "stale" as const,
          provenance: "stale" as const,
          staleReason: `Linked file "${item.filePath}" was modified on disk (hash changed).`
        };
      }

      if (item.endLine && item.endLine > lineCount) {
        if (!wasStale) newlyStaleCount += 1;
        return {
          ...item,
          verificationStatus: "stale" as const,
          provenance: "stale" as const,
          staleReason: `Linked line range ${item.startLine ?? 1}-${item.endLine} exceeds current file length (${lineCount} lines).`
        };
      }

      if (item.symbolName && indexer) {
        const syms = indexer.getFileSymbols(item.filePath);
        if (syms.length > 0 && !syms.some((s) => s.name === item.symbolName)) {
          if (!wasStale) newlyStaleCount += 1;
          return {
            ...item,
            verificationStatus: "stale" as const,
            provenance: "stale" as const,
            staleReason: `Linked symbol "${item.symbolName}" is no longer present in "${item.filePath}".`
          };
        }
      }

      return {
        ...item,
        verificationStatus: "current" as const,
        staleReason: null
      };
    });

    const nextVerificationStatus = computeDecisionVerificationState(
      decision.status,
      updatedEvidence
    );

    const history =
      newlyStaleCount > 0
        ? [
            ...decision.history,
            {
              id: `hist-${crypto.randomUUID().slice(0, 10)}`,
              type: "evidence_stale" as const,
              summary: `${newlyStaleCount} linked evidence item(s) became stale after workspace changes.`,
              timestamp: new Date().toISOString(),
              actor: "system" as const
            }
          ]
        : decision.history;

    return {
      newlyStaleCount,
      decision: {
        ...decision,
        evidence: updatedEvidence,
        verificationStatus: nextVerificationStatus,
        history
      }
    };
  }

  /**
   * Explicitly revalidates stale evidence after developer review:
   * archives stale snapshots as `isHistorical: true` (preserving historical evidence)
   * and records fresh current hashes for existing files.
   */
  public revalidateDecisionEvidence(params: {
    authorizedRoot: string;
    decision: EngineeringDecision;
  }): EngineeringDecision {
    const { authorizedRoot, decision } = params;
    const now = new Date().toISOString();
    const nextEvidence: DecisionEvidence[] = [];

    for (const item of decision.evidence) {
      if (item.isHistorical || !item.filePath || item.verificationStatus !== "stale") {
        nextEvidence.push(item);
        continue;
      }

      // Preserve historical record
      nextEvidence.push({ ...item, isHistorical: true });

      // Refresh hash if the file still exists on disk
      try {
        const absPath = this.authority.resolveSafePath(authorizedRoot, item.filePath);
        if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
          const rawBuf = fs.readFileSync(absPath);
          const freshHash = computeContentSha256(rawBuf);
          const lineCount = Math.max(1, rawBuf.toString("utf8").split(/\r?\n/).length);
          nextEvidence.push({
            ...item,
            id: `ev-${crypto.randomUUID().slice(0, 12)}`,
            contentHash: freshHash,
            endLine: item.endLine ? Math.min(item.endLine, lineCount) : undefined,
            startLine: item.startLine ? Math.min(item.startLine, lineCount) : undefined,
            verificationStatus: "current",
            provenance: "verified",
            staleReason: null,
            isHistorical: false,
            timestamp: now
          });
        }
      } catch {
        // File no longer exists; historical record preserved
      }
    }

    const nextVerificationStatus = computeDecisionVerificationState(decision.status, nextEvidence);
    return {
      ...decision,
      evidence: nextEvidence,
      verificationStatus: nextVerificationStatus,
      updatedAt: now,
      history: [
        ...decision.history,
        {
          id: `hist-${crypto.randomUUID().slice(0, 10)}`,
          type: "revalidated",
          summary: "Developer reviewed changes and revalidated decision evidence.",
          timestamp: now,
          actor: "developer"
        }
      ]
    };
  }
}
