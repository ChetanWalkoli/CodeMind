import crypto from "node:crypto";
import fs from "node:fs";
import {
  classifyFileRole,
  classifyQueryIntent,
  computeContextSnapshotId,
  computeRoleRelevanceAdjustment,
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
  CodeSymbol,
  ContextExcludedItem,
  ContextExclusionReason,
  ContextInclusionReason,
  ContextItem
} from "@codemind/shared";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";

const DEFAULT_CONTEXT_BUDGET_BYTES = APP_CONSTANTS.DEFAULT_CONTEXT_BYTES;
const DEFAULT_PER_FILE_MAX_BYTES = APP_CONSTANTS.DEFAULT_PER_FILE_MAX_BYTES;
const DEFAULT_MAX_FILES = 14;
const MAX_PER_FILE_HARD_CAP = 64 * 1024;
const MIN_PER_FILE_BUDGET = 512;

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

interface BoundedSliceResult {
  text: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  byteLength: number;
}

function truncateToLineBudget(content: string, maxBytes: number): BoundedSliceResult {
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

/**
 * Symbol-aware slicing for oversized files.
 * When a file exceeds the per-file byte cap, slices cleanly around matched
 * or exported symbol line ranges instead of blindly taking only lines 1..N.
 * Always produces an accurate 1-based [startLine, endLine] range for citation validation.
 */
function sliceToSymbolAwareBudget(
  content: string,
  maxBytes: number,
  fileSymbols: CodeSymbol[],
  matchedSymbolNames: Set<string>,
  queryTerms: string[]
): BoundedSliceResult {
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

  if (fileSymbols.length === 0) {
    return truncateToLineBudget(content, maxBytes);
  }

  // Pick symbols that matched the query or contain query terms; fall back to exported symbols.
  const matchedSymbols = fileSymbols.filter((sym) => {
    if (matchedSymbolNames.has(sym.name)) return true;
    const lower = sym.name.toLowerCase();
    return queryTerms.some((term) => term.length >= 3 && lower.includes(term));
  });

  const targetSymbols =
    matchedSymbols.length > 0 ? matchedSymbols : fileSymbols.filter((sym) => sym.exported);

  if (targetSymbols.length === 0) {
    return truncateToLineBudget(content, maxBytes);
  }

  const sortedByLine = [...targetSymbols].sort((a, b) => a.startLine - b.startLine);
  const firstSym = sortedByLine[0];
  if (!firstSym) {
    return truncateToLineBudget(content, maxBytes);
  }
  const anchorLine = Math.max(1, firstSym.startLine - 2);

  // If the anchor is already near the top of the file, standard head slice is cleaner.
  if (anchorLine <= 12) {
    return truncateToLineBudget(content, maxBytes);
  }

  const startIdx = Math.min(anchorLine - 1, Math.max(0, lines.length - 1));
  const kept: string[] = [];
  let usedBytes = 0;

  for (let i = startIdx; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) break;
    const lineBytes = Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0);
    if (usedBytes + lineBytes > maxBytes) {
      break;
    }
    kept.push(line);
    usedBytes += lineBytes;
  }

  if (kept.length === 0) {
    return truncateToLineBudget(content, maxBytes);
  }

  const text = kept.join("\n");
  return {
    text,
    startLine: startIdx + 1,
    endLine: startIdx + kept.length,
    truncated: true,
    byteLength: Buffer.byteLength(text, "utf8")
  };
}

interface CandidateAccumulator {
  filePath: string;
  relevanceScore: number;
  reasons: Set<ContextInclusionReason>;
  symbols: Set<string>;
  matchedTerms: Set<string>;
  isExplicitOverride: boolean;
}

/**
 * Deterministic, local-only workspace context builder.
 * Uses ProjectIndexer for symbol/file/dependency/API-relationship retrieval and strictly
 * enforces workspace containment, secret exclusion, role-aware ranking, and byte budgets.
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
    const perFileMaxBytes = Math.max(
      MIN_PER_FILE_BUDGET,
      Math.min(
        request.perFileMaxBytes ?? DEFAULT_PER_FILE_MAX_BYTES,
        budgetBytes,
        MAX_PER_FILE_HARD_CAP
      )
    );
    const maxFiles = request.maxFiles ?? DEFAULT_MAX_FILES;
    const ignore = CodeEngineIgnore.fromWorkspace(authorizedRoot, params.customExcludes ?? []);
    const userExcludedSet = new Set((request.excludedFilePaths ?? []).map(normalizePosix));
    const queryIntent = classifyQueryIntent(request.query);

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
      options?: { symbolName?: string; term?: string; isExplicitOverride?: boolean }
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
        if (options?.symbolName) existing.symbols.add(options.symbolName);
        if (options?.term) existing.matchedTerms.add(options.term);
        if (options?.isExplicitOverride) existing.isExplicitOverride = true;
      } else {
        candidates.set(posix, {
          filePath: posix,
          relevanceScore: scoreDelta,
          reasons: new Set([reason]),
          symbols: options?.symbolName ? new Set([options.symbolName]) : new Set(),
          matchedTerms: options?.term ? new Set([options.term]) : new Set(),
          isExplicitOverride: options?.isExplicitOverride ?? false
        });
      }
    };

    // 1. Active file seed
    if (request.activeFilePath) {
      addCandidate(request.activeFilePath, 100, "active-file", { isExplicitOverride: true });
    }

    // 2. Explicitly requested / manually added files
    for (const explicit of request.explicitFilePaths ?? []) {
      addCandidate(explicit, 115, "explicit-file", { isExplicitOverride: true });
      const posix = normalizePosix(explicit);
      const existing = candidates.get(posix);
      if (existing) {
        existing.reasons.add("user-added");
      }
    }

    // 3. Query-driven symbol & file retrieval with normalization and bounded typo tolerance
    const terms = extractQueryTerms(request.query);
    for (const term of terms) {
      const symbolMatches = indexer.searchSymbols(term, { limit: 18 });
      for (const match of symbolMatches) {
        const score = match.score;
        let delta: number;
        let reason: ContextInclusionReason;
        if (score >= 0.9) {
          delta = 60;
          reason = "symbol-match";
        } else if (score >= 0.72) {
          delta = 46;
          reason = "symbol-match";
        } else if (score >= 0.55) {
          delta = 34;
          reason = "normalized-match";
        } else {
          delta = 24;
          reason = "fuzzy-match";
        }
        addCandidate(match.symbol.filePath, delta, reason, {
          symbolName: match.symbol.name,
          term
        });
      }

      const fileMatches = indexer.searchFilesDetailed(term, 18);
      for (const fileMatch of fileMatches) {
        let delta = 24;
        let reason: ContextInclusionReason = "fuzzy-match";
        switch (fileMatch.matchKind) {
          case "exact":
            delta = 52;
            reason = "path-match";
            break;
          case "prefix":
            delta = 42;
            reason = "path-match";
            break;
          case "normalized":
            delta = 36;
            reason = "normalized-match";
            break;
          case "substring":
            delta = 30;
            reason = "path-match";
            break;
          case "fuzzy":
            delta = 24;
            reason = "fuzzy-match";
            break;
        }
        addCandidate(fileMatch.file.path, delta, reason, { term });
      }
    }

    // 4. Multi-term synergy bonus (rewards files matching multiple distinct query concepts)
    for (const candidate of candidates.values()) {
      if (candidate.matchedTerms.size > 1) {
        candidate.relevanceScore += Math.min(54, (candidate.matchedTerms.size - 1) * 18);
      }
    }

    // 5. Architecture/codebase fallback if no strong seeds matched
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

    // 6. Implementation-aware role adjustment (before seed expansion so seeds are high-signal)
    const applyRoleAdjustment = (candidate: CandidateAccumulator) => {
      if (candidate.isExplicitOverride) {
        return;
      }
      const symbolNames = indexer.getFileSymbols(candidate.filePath).map((s) => s.name);
      const role = classifyFileRole(candidate.filePath, symbolNames);
      const delta = computeRoleRelevanceAdjustment(queryIntent, role, candidate.filePath);
      candidate.relevanceScore = Math.max(1, candidate.relevanceScore + delta);
      if (delta > 0 && role === "backend-implementation") {
        candidate.reasons.add("backend-implementation");
      } else if (delta > 0 && role === "frontend-integration") {
        candidate.reasons.add("frontend-integration");
      }
    };

    const roleAdjustedPaths = new Set<string>();
    for (const candidate of candidates.values()) {
      applyRoleAdjustment(candidate);
      roleAdjustedPaths.add(candidate.filePath);
    }

    // 7. Dependency-aware & Cross-Layer API relationship expansion around top seeds
    if (request.includeDependencies !== false && candidates.size > 0) {
      const topSeeds = rankContextCandidates(Array.from(candidates.values())).slice(0, 6);

      for (const seed of topSeeds) {
        // Direct import dependencies
        for (const dep of indexer.getDependencies(seed.filePath)) {
          addCandidate(dep.targetId, 26, "dependency");
        }
        // Direct dependents
        for (const dependent of indexer.getDependents(seed.filePath)) {
          addCandidate(dependent.sourceId, 20, "dependent");
        }

        // Cross-layer HTTP API relationships (frontend fetch/axios <-> backend route/handler)
        const apiRels = indexer.getApiRelationshipsForFile(seed.filePath);
        for (const rel of apiRels) {
          const peerFile = rel.callerFile === seed.filePath ? rel.handlerFile : rel.callerFile;
          if (!peerFile || peerFile === seed.filePath) continue;

          const apiBoost =
            rel.confidence === "confirmed" ? (rel.ambiguous ? 32 : 48) : rel.ambiguous ? 24 : 36;
          addCandidate(peerFile, apiBoost, "api-relationship");

          // Follow up to 2 hops of direct local dependencies from a discovered backend handler
          // (e.g. route -> controller -> service) so the core implementation is included.
          const hop1Deps = indexer.getDependencies(peerFile);
          for (const hop1 of hop1Deps) {
            addCandidate(hop1.targetId, 28, "dependency");
            const hop2Deps = indexer.getDependencies(hop1.targetId);
            for (const hop2 of hop2Deps) {
              addCandidate(hop2.targetId, 22, "dependency");
            }
          }
        }
      }

      // Apply role adjustment to newly discovered candidates from dependency/API expansion
      for (const candidate of candidates.values()) {
        if (!roleAdjustedPaths.has(candidate.filePath)) {
          applyRoleAdjustment(candidate);
          roleAdjustedPaths.add(candidate.filePath);
        }
      }
    }

    // 8. Deterministic ranking & budget-bounded file reading with symbol-aware slicing
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

      // Always hash the full on-disk file so SecureTransmissionGate can verify integrity.
      const contentHash = crypto.createHash("sha256").update(rawBuffer).digest("hex");
      const effectivePerFileBudget = Math.min(remainingBytes, perFileMaxBytes);
      const entry = indexer.getFileEntry(candidate.filePath);
      const fileSymbols = entry?.symbols ?? [];

      const bounded = sliceToSymbolAwareBudget(
        fullText,
        effectivePerFileBudget,
        fileSymbols,
        candidate.symbols,
        terms
      );

      if (bounded.byteLength === 0 && fullText.length > 0) {
        recordExcluded(candidate.filePath, "budget-exceeded");
        continue;
      }

      const symbolNames = Array.from(
        new Set([...candidate.symbols, ...fileSymbols.map((s) => s.name)])
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
      coverage: {
        totalCandidates: ranked.length,
        selectedFiles: Math.min(ranked.length, maxFiles),
        includedFiles: items.length,
        excludedFiles: excluded.length,
        truncatedFiles: items.filter((item) => item.truncated).length,
        perFileMaxBytes,
        queryIntent
      },
      createdAt: new Date().toISOString()
    };
  }
}
