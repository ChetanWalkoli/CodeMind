import crypto from "node:crypto";
import type { AITaskType, ContextInclusionReason, ContextItem } from "@codemind/shared";

const STOP_WORDS = new Set([
  "in",
  "of",
  "to",
  "on",
  "at",
  "by",
  "is",
  "as",
  "or",
  "an",
  "be",
  "do",
  "it",
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "how",
  "does",
  "what",
  "where",
  "when",
  "why",
  "are",
  "can",
  "you",
  "explain",
  "show",
  "tell",
  "about",
  "into",
  "file",
  "files",
  "code",
  "codebase"
]);

/**
 * Deterministic token count estimator (~4 characters per token).
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Extracts deterministic, deduplicated search terms from a developer query.
 */
export function extractQueryTerms(query: string): string[] {
  const rawTokens = query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  return Array.from(new Set(rawTokens)).sort((a, b) => a.localeCompare(b));
}

export interface RankedContextCandidate {
  filePath: string;
  relevanceScore: number;
  reasons: ContextInclusionReason[];
  matchedSymbols: string[];
}

/**
 * Deterministic relevance ranking: highest relevanceScore first, then lexicographical filePath asc.
 */
export function rankContextCandidates<T extends { filePath: string; relevanceScore: number }>(
  candidates: T[]
): T[] {
  return [...candidates].sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return a.filePath.localeCompare(b.filePath);
  });
}

/**
 * Computes a deterministic SHA-256 snapshot fingerprint bound to the exact
 * workspace, task, template version, query, and included source items.
 * Any change to query, task, file selection, or file contents produces a new snapshotId.
 */
export function computeContextSnapshotId(input: {
  workspaceRoot: string;
  taskType: AITaskType;
  templateId: string;
  templateVersion: string;
  query: string;
  items: Pick<ContextItem, "filePath" | "contentHash" | "startLine" | "endLine" | "content">[];
}): string {
  const canonicalPayload = JSON.stringify({
    workspaceRoot: input.workspaceRoot,
    taskType: input.taskType,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    query: input.query.trim(),
    items: input.items.map((item) => ({
      filePath: item.filePath,
      contentHash: item.contentHash,
      startLine: item.startLine,
      endLine: item.endLine,
      content: item.content
    }))
  });

  return crypto.createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}
