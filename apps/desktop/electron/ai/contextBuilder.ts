import crypto from "node:crypto";
import fs from "node:fs";
import {
  computeContextSnapshotId,
  detectInlineSecrets,
  estimateTokenCount,
  extractQueryTerms,
  getPromptTemplate,
  rankContextCandidates
} from "@codemind/ai-core";
import { CodeEngineIgnore, isSecretFilePath, type ProjectIndexer } from "@codemind/code-engine";
import { APP_CONSTANTS } from "@codemind/config";
import type {
  AIContextBuildRequest,
  AIContextSnapshot,
  ContextExcludedItem,
  ContextExclusionReason,
  ContextInclusionReason,
  ContextItem
} from "@codemind/shared";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";

const DEFAULT_CONTEXT_BUDGET_BYTES = 32 * 1024;
const DEFAULT_MAX_FILES = 10;
const MAX_SINGLE_FILE_BYTES = 16 * 1024;

const EXTRA_SENSITIVE_BASENAME_PATTERNS: RegExp[] = [
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /\.p8$/i,
  /^ai-credentials\.enc\.json$/i,
  /^secrets?\./i,
  /credentials.*\.json$/i
];

function normalizePosix(relPath: string): string {
  return relPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isSensitiveContextFilePath(relativePath: string): boolean {
  const posix = normalizePosix(relativePath);
  if (isSecretFilePath(posix)) {
    return true;
  }
  const baseName = posix.split("/").pop() ?? posix;
  return EXTRA_SENSITIVE_BASENAME_PATTERNS.some((pattern) => pattern.test(baseName));
}

function isLikelyBinary(buffer: Buffer): boolean {
  const sampleLen = Math.min(buffer.length, 8192);
  for (let i = 0; i < sampleLen; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function truncateToLineBudget(
  content: string,
  maxBytes: number
): { text: string; startLine: number; endLine: number; truncated: boolean; byteLength: number } {
  const fullBytes = Buffer.byteLength(content, "utf8");
  const lines = content.split(/\r?\n/);

  if (fullBytes <= maxBytes) {
    return {
      text: content,
      startLine: 1,
      endLine: Math.max(1, lines.length),
      truncated: false,
      byteLength: fullBytes
    };
  }

  const kept: string[] = [];
  let usedBytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0);
    if (usedBytes + lineBytes > maxBytes) {
      break;
    }
    kept.push(line);
    usedBytes += lineBytes;
  }

  const text = kept.join("\n");
  return {
    text,
    startLine: 1,
    endLine: Math.max(1, kept.length),
    truncated: true,
    byteLength: Buffer.byteLength(text, "utf8")
  };
}

interface CandidateAccumulator {
  filePath: string;
  relevanceScore: number;
  reasons: Set<ContextInclusionReason>;
  symbols: Set<string>;
}

/**
 * Deterministic, local-only workspace context builder.
 * Uses ProjectIndexer for symbol/file/dependency retrieval and strictly enforces
 * workspace containment, secret exclusion, and byte budgets.
 * NEVER triggers any AI provider request.
 */
export class WorkspaceContextBuilder {
  private readonly authority: WorkspaceAuthority;

  constructor(authority: WorkspaceAuthority) {
    this.authority = authority;
  }

  public buildSnapshot(params: {
    authorizedRoot: string;
    indexer: ProjectIndexer;
    request: AIContextBuildRequest;
    customExcludes?: string[];
  }): AIContextSnapshot {
    const { authorizedRoot, indexer, request } = params;
    const budgetBytes = Math.min(
      request.maxBytes ?? DEFAULT_CONTEXT_BUDGET_BYTES,
      APP_CONSTANTS.MAX_CONTEXT_BYTES
    );
    const maxFiles = request.maxFiles ?? DEFAULT_MAX_FILES;
    const ignore = CodeEngineIgnore.fromWorkspace(authorizedRoot, params.customExcludes ?? []);
    const userExcludedSet = new Set((request.excludedFilePaths ?? []).map(normalizePosix));

    const excludedMap = new Map<string, ContextExclusionReason>();
    const recordExcluded = (filePath: string, reason: ContextExclusionReason) => {
      const normalized = normalizePosix(filePath);
      if (!normalized) return;
      if (!excludedMap.has(normalized)) {
        excludedMap.set(normalized, reason);
      }
    };

    const candidates = new Map<string, CandidateAccumulator>();
    const addCandidate = (
      rawPath: string,
      scoreDelta: number,
      reason: ContextInclusionReason,
      symbolName?: string
    ) => {
      const posix = normalizePosix(rawPath);
      if (!posix) return;

      if (isSensitiveContextFilePath(posix)) {
        recordExcluded(posix, "secret-file");
        return;
      }

      if (userExcludedSet.has(posix)) {
        recordExcluded(posix, "user-excluded");
        return;
      }

      if (ignore.shouldIgnore(posix, false)) {
        recordExcluded(posix, "ignored-path");
        return;
      }

      const existing = candidates.get(posix);
      if (existing) {
        existing.relevanceScore += scoreDelta;
        existing.reasons.add(reason);
        if (symbolName) existing.symbols.add(symbolName);
      } else {
        candidates.set(posix, {
          filePath: posix,
          relevanceScore: scoreDelta,
          reasons: new Set([reason]),
          symbols: symbolName ? new Set([symbolName]) : new Set()
        });
      }
    };

    // 1. Active file seed
    if (request.activeFilePath) {
      addCandidate(request.activeFilePath, 100, "active-file");
    }

    // 2. Explicitly requested files
    for (const explicit of request.explicitFilePaths ?? []) {
      addCandidate(explicit, 90, "explicit-file");
    }

    // 3. Query-driven symbol & file retrieval via ProjectIndexer
    const terms = extractQueryTerms(request.query);
    for (const term of terms) {
      const symbolMatches = indexer.searchSymbols(term, { limit: 15 });
      for (const match of symbolMatches) {
        const lowerName = match.symbol.name.toLowerCase();
        const delta = lowerName === term ? 60 : lowerName.startsWith(term) ? 45 : 30;
        addCandidate(match.symbol.filePath, delta, "symbol-match", match.symbol.name);
      }

      const fileMatches = indexer.searchFiles(term, 15);
      for (const fileNode of fileMatches) {
        addCandidate(fileNode.path, 35, "path-match");
      }
    }

    // 4. Architecture/codebase fallback if no strong seeds matched
    if (
      candidates.size === 0 &&
      (request.taskType === "explain-codebase" || request.taskType === "architecture-overview")
    ) {
      const snapshot = indexer.getGraphSnapshot();
      const sortedNodes = [...snapshot.nodes]
        .map((node) => ({
          path: node.path,
          symbolCount: indexer.getFileSymbols(node.path).length
        }))
        .sort((a, b) => b.symbolCount - a.symbolCount || a.path.localeCompare(b.path));
      for (const node of sortedNodes.slice(0, maxFiles)) {
        addCandidate(node.path, 15 + Math.min(node.symbolCount, 20), "architecture-summary");
      }
    }

    // 5. Dependency-aware expansion around top seed files
    if (request.includeDependencies !== false && candidates.size > 0) {
      const topSeeds = rankContextCandidates(Array.from(candidates.values())).slice(0, 4);
      for (const seed of topSeeds) {
        for (const dep of indexer.getDependencies(seed.filePath)) {
          addCandidate(dep.targetId, 25, "dependency");
        }
        for (const dependent of indexer.getDependents(seed.filePath)) {
          addCandidate(dependent.sourceId, 20, "dependent");
        }
      }
    }

    // 6. Deterministic ranking & budget-bounded file reading
    const ranked = rankContextCandidates(Array.from(candidates.values()));
    const items: ContextItem[] = [];
    let totalBytes = 0;

    for (const candidate of ranked) {
      if (items.length >= maxFiles) {
        recordExcluded(candidate.filePath, "budget-exceeded");
        continue;
      }

      const remainingBytes = budgetBytes - totalBytes;
      if (remainingBytes < 128) {
        recordExcluded(candidate.filePath, "budget-exceeded");
        continue;
      }

      let safeAbsPath: string;
      try {
        safeAbsPath = this.authority.resolveSafePath(authorizedRoot, candidate.filePath);
      } catch {
        recordExcluded(candidate.filePath, "outside-workspace");
        continue;
      }

      let rawBuffer: Buffer;
      try {
        const stat = fs.statSync(safeAbsPath);
        if (!stat.isFile()) {
          recordExcluded(candidate.filePath, "binary-or-unreadable");
          continue;
        }
        rawBuffer = fs.readFileSync(safeAbsPath);
      } catch {
        recordExcluded(candidate.filePath, "binary-or-unreadable");
        continue;
      }

      if (isLikelyBinary(rawBuffer)) {
        recordExcluded(candidate.filePath, "binary-or-unreadable");
        continue;
      }

      const fullText = rawBuffer.toString("utf8");
      if (detectInlineSecrets(fullText).length > 0) {
        recordExcluded(candidate.filePath, "inline-secret");
        continue;
      }

      const contentHash = crypto.createHash("sha256").update(rawBuffer).digest("hex");
      const perFileBudget = Math.min(remainingBytes, MAX_SINGLE_FILE_BYTES);
      const bounded = truncateToLineBudget(fullText, perFileBudget);

      if (bounded.byteLength === 0 && fullText.length > 0) {
        recordExcluded(candidate.filePath, "budget-exceeded");
        continue;
      }

      const entry = indexer.getFileEntry(candidate.filePath);
      const symbolNames = Array.from(
        new Set([...candidate.symbols, ...(entry?.symbols.map((s) => s.name) ?? [])])
      ).sort((a, b) => a.localeCompare(b));

      const reasons = Array.from(candidate.reasons).sort((a, b) => a.localeCompare(b));

      items.push({
        id: `${candidate.filePath}:${bounded.startLine}-${bounded.endLine}`,
        filePath: candidate.filePath,
        language: entry?.node.language ?? "text",
        contentHash,
        startLine: bounded.startLine,
        endLine: bounded.endLine,
        symbols: symbolNames.slice(0, 25),
        reasons,
        relevanceScore: candidate.relevanceScore,
        byteLength: bounded.byteLength,
        estimatedTokens: estimateTokenCount(bounded.text),
        truncated: bounded.truncated,
        content: bounded.text
      });

      totalBytes += bounded.byteLength;
    }

    const template = getPromptTemplate(request.taskType);
    const snapshotId = computeContextSnapshotId({
      workspaceRoot: authorizedRoot,
      taskType: request.taskType,
      templateId: template.id,
      templateVersion: template.version,
      query: request.query,
      items
    });

    const excluded: ContextExcludedItem[] = Array.from(excludedMap.entries())
      .map(([filePath, reason]) => ({ filePath, reason }))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));

    const estimatedTokens = items.reduce((acc, item) => acc + item.estimatedTokens, 0);

    return {
      snapshotId,
      workspaceRoot: authorizedRoot,
      taskType: request.taskType,
      templateId: template.id,
      templateVersion: template.version,
      query: request.query,
      items,
      excluded,
      totalBytes,
      estimatedTokens,
      budgetBytes,
      createdAt: new Date().toISOString()
    };
  }
}
