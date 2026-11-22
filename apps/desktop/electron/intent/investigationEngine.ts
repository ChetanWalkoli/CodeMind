import crypto from "node:crypto";
import fs from "node:fs";
import {
  classifyFileRole,
  classifyQueryIntent,
  computeRoleRelevanceAdjustment,
  detectInlineSecrets,
  extractQueryTerms
} from "@codemind/ai-core";
import { CodeEngineIgnore, type ProjectIndexer } from "@codemind/code-engine";
import {
  InvestigationLimitsSchema,
  InvestigationReportSchema,
  type IntentRequest,
  type InvestigationApiLink,
  type InvestigationEvidenceRef,
  type InvestigationFileRecord,
  type InvestigationLimits,
  type InvestigationProgressStage,
  type InvestigationRelation,
  type InvestigationReport,
  type InvestigationSymbolRecord
} from "@codemind/shared";
import { isSensitiveContextFilePath } from "../ai/contextBuilder.js";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";

function normalizePosix(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isTestFilePath(filePath: string): boolean {
  return /(?:^|\/)(?:__tests__|tests?|specs?)\/|(?:\.test|\.spec)\.[A-Za-z0-9]+$/i.test(filePath);
}

function isConfigOrSchemaPath(filePath: string): boolean {
  return /(?:schema|config|tsconfig|package\.json|\.eslintrc|vite\.config|prisma)/i.test(filePath);
}

/**
 * Deterministic, bounded Codebase Investigation Engine (Milestone 6.2).
 * Reuses ProjectIndexer, SearchIndex, DependencyGraph, ApiRelationshipExtractor,
 * WorkspaceAuthority, and CodeEngineIgnore. Never executes code or scans excluded/secret files.
 */
export class InvestigationEngine {
  private readonly authority: WorkspaceAuthority;

  constructor(authority: WorkspaceAuthority) {
    this.authority = authority;
  }

  public investigate(params: {
    authorizedRoot: string;
    indexer: ProjectIndexer;
    intent: IntentRequest;
    customExcludes?: string[];
    limits?: Partial<InvestigationLimits>;
    onProgress?: (stage: InvestigationProgressStage, detail: string) => void;
  }): InvestigationReport {
    const startedAt = Date.now();
    const { authorizedRoot, indexer, intent, onProgress } = params;
    const limits = InvestigationLimitsSchema.parse(params.limits ?? {});
    const ignore = CodeEngineIgnore.fromWorkspace(authorizedRoot, params.customExcludes ?? []);

    onProgress?.("understanding_request", "Extracting query terms and scope.");
    const queryText = `${intent.normalizedGoal} ${intent.affectedAreas.join(" ")}`.trim();
    const terms = extractQueryTerms(queryText);
    const queryIntent = classifyQueryIntent(queryText);

    const scoreMap = new Map<string, { score: number; reasons: Set<string> }>();
    const missingContext: string[] = [];
    const limitations: string[] = [];

    const isAllowedPath = (rawPath: string): boolean => {
      const posix = normalizePosix(rawPath);
      if (!posix) return false;
      if (isSensitiveContextFilePath(posix)) return false;
      if (ignore.shouldIgnore(posix, false)) return false;
      try {
        const abs = this.authority.resolveSafePath(authorizedRoot, posix);
        return fs.statSync(abs).isFile();
      } catch {
        return false;
      }
    };

    const addCandidate = (rawPath: string, delta: number, reason: string) => {
      const posix = normalizePosix(rawPath);
      if (!isAllowedPath(posix)) return;
      const existing = scoreMap.get(posix);
      if (existing) {
        existing.score += delta;
        existing.reasons.add(reason);
      } else {
        scoreMap.set(posix, { score: delta, reasons: new Set([reason]) });
      }
    };

    // 1. Discovering seed files
    onProgress?.("discovering_files", "Searching indexed files and symbols.");

    for (const explicitFile of intent.relevantFiles) {
      if (isAllowedPath(explicitFile)) {
        addCandidate(explicitFile, 110, "explicit-intent-file");
      } else {
        missingContext.push(`Requested file "${explicitFile}" was not found or is excluded.`);
      }
    }

    for (const term of terms) {
      const symMatches = indexer.searchSymbols(term, { limit: 15 });
      for (const m of symMatches) {
        addCandidate(m.symbol.filePath, Math.round(50 * m.score), "symbol-match");
      }
      const fileMatches = indexer.searchFilesDetailed(term, 15);
      for (const fm of fileMatches) {
        addCandidate(fm.file.path, Math.round(45 * fm.score), `file-${fm.matchKind}`);
      }
    }

    // Apply role-based scoring adjustments
    for (const [filePath, meta] of scoreMap.entries()) {
      const symNames = indexer.getFileSymbols(filePath).map((s) => s.name);
      const role = classifyFileRole(filePath, symNames);
      meta.score = Math.max(
        1,
        meta.score + computeRoleRelevanceAdjustment(queryIntent, role, filePath)
      );
    }

    // 2. Bounded graph traversal (direct + transitive up to maxGraphDepth)
    onProgress?.("exploring_dependencies", "Traversing dependency graph within bounded depth.");
    const relations: InvestigationRelation[] = [];
    const seenRelationKeys = new Set<string>();
    const addRelation = (rel: InvestigationRelation) => {
      const key = `${rel.sourceFile}->${rel.targetFile}:${rel.type}`;
      if (seenRelationKeys.has(key)) return;
      seenRelationKeys.add(key);
      relations.push(rel);
    };

    const seedPaths = Array.from(scoreMap.entries())
      .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([p]) => p);

    const visited = new Set<string>(seedPaths);
    let frontier = [...seedPaths];

    for (let depth = 1; depth <= limits.maxGraphDepth; depth += 1) {
      const nextFrontier: string[] = [];
      const decay = depth === 1 ? 26 : 16;

      for (const current of frontier) {
        for (const dep of indexer.getDependencies(current)) {
          if (!isAllowedPath(dep.targetId)) continue;
          addCandidate(dep.targetId, decay, `dependency-depth-${depth}`);
          addRelation({
            sourceFile: current,
            targetFile: dep.targetId,
            type:
              /routes?/i.test(current) && /controllers?/i.test(dep.targetId)
                ? "route_to_controller"
                : "import_dependency",
            evidence: `Static import from ${current} to ${dep.targetId}`,
            confidence: dep.confidence
          });
          if (!visited.has(dep.targetId) && scoreMap.size < limits.maxFiles * 3) {
            visited.add(dep.targetId);
            nextFrontier.push(dep.targetId);
          }
        }

        for (const rev of indexer.getDependents(current)) {
          if (!isAllowedPath(rev.sourceId)) continue;
          const isTest = isTestFilePath(rev.sourceId);
          addCandidate(rev.sourceId, isTest ? 22 : 18, isTest ? "test-dependent" : "dependent");
          addRelation({
            sourceFile: rev.sourceId,
            targetFile: current,
            type: isTest ? "test_coverage" : "reverse_dependent",
            evidence: isTest
              ? `Test file ${rev.sourceId} imports ${current}`
              : `${rev.sourceId} imports ${current}`,
            confidence: rev.confidence
          });
        }
      }

      frontier = nextFrontier;
      if (frontier.length === 0) break;
    }

    // 3. Cross-layer API relationships
    onProgress?.(
      "tracing_api_relationships",
      "Tracing frontend-to-backend HTTP API relationships."
    );
    const apiLinks: InvestigationApiLink[] = [];
    const seenApiKeys = new Set<string>();

    for (const filePath of Array.from(scoreMap.keys())) {
      const rels = indexer.getApiRelationshipsForFile(filePath);
      for (const rel of rels) {
        if (!isAllowedPath(rel.callerFile) || !isAllowedPath(rel.handlerFile)) continue;
        const key = `${rel.method}:${rel.endpoint}:${rel.callerFile}->${rel.handlerFile}`;
        if (seenApiKeys.has(key)) continue;
        seenApiKeys.add(key);

        apiLinks.push({
          method: rel.method,
          endpoint: rel.endpoint,
          callerFile: rel.callerFile,
          callerLine: rel.callerLine,
          handlerFile: rel.handlerFile,
          handlerLine: rel.handlerLine,
          confidence: rel.confidence,
          explanation: rel.explanation
        });

        addRelation({
          sourceFile: rel.callerFile,
          targetFile: rel.handlerFile,
          type: "api_endpoint",
          evidence: rel.explanation,
          confidence: rel.confidence
        });

        const peer = rel.callerFile === filePath ? rel.handlerFile : rel.callerFile;
        addCandidate(peer, rel.confidence === "confirmed" ? 42 : 28, "api-relationship");

        // Follow 2 hops of dependencies from discovered backend handler (route -> controller -> service)
        for (const hop1 of indexer.getDependencies(peer)) {
          if (!isAllowedPath(hop1.targetId)) continue;
          addCandidate(hop1.targetId, 26, "api-handler-dependency");
          addRelation({
            sourceFile: peer,
            targetFile: hop1.targetId,
            type:
              /routes?/i.test(peer) && /controllers?/i.test(hop1.targetId)
                ? "route_to_controller"
                : "import_dependency",
            evidence: `Handler dependency from ${peer} to ${hop1.targetId}`,
            confidence: hop1.confidence
          });
          for (const hop2 of indexer.getDependencies(hop1.targetId)) {
            if (!isAllowedPath(hop2.targetId)) continue;
            addCandidate(hop2.targetId, 20, "api-handler-service");
          }
        }
      }
    }

    // 4. Rank, apply hard limits, read hashes & collect bounded evidence references
    onProgress?.("collecting_evidence", "Reading verified source hashes and evidence snippets.");
    const rankedPaths = Array.from(scoreMap.entries()).sort(
      (a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0])
    );

    if (rankedPaths.length > limits.maxFiles) {
      limitations.push(
        `Investigation capped at ${limits.maxFiles} files (${rankedPaths.length} total candidates discovered).`
      );
    }

    const selected = rankedPaths.slice(0, limits.maxFiles);
    const relevantFiles: InvestigationFileRecord[] = [];
    const relevantSymbols: InvestigationSymbolRecord[] = [];
    const evidenceReferences: InvestigationEvidenceRef[] = [];
    const testFiles: string[] = [];
    const configAndSchemaFiles: string[] = [];
    let totalBytesInspected = 0;

    for (const [filePath, meta] of selected) {
      if (totalBytesInspected >= limits.maxContextBytes) {
        limitations.push(
          `Reached maxContextBytes (${limits.maxContextBytes} bytes) during evidence collection.`
        );
        break;
      }

      let rawBuffer: Buffer;
      try {
        const abs = this.authority.resolveSafePath(authorizedRoot, filePath);
        rawBuffer = fs.readFileSync(abs);
      } catch {
        continue;
      }

      const content = rawBuffer.toString("utf8");
      if (detectInlineSecrets(content).length > 0) {
        limitations.push(`Excluded "${filePath}" because inline secret pattern was detected.`);
        continue;
      }

      const contentHash = crypto.createHash("sha256").update(rawBuffer).digest("hex");
      const lines = content.split(/\r?\n/);
      const entry = indexer.getFileEntry(filePath);
      const symbols = entry?.symbols ?? [];
      const role = classifyFileRole(
        filePath,
        symbols.map((s) => s.name)
      );

      totalBytesInspected += rawBuffer.byteLength;

      relevantFiles.push({
        filePath,
        language: entry?.node.language ?? "text",
        role,
        contentHash,
        lineCount: Math.max(1, lines.length),
        relevanceScore: meta.score,
        reasons: Array.from(meta.reasons).sort()
      });

      if (isTestFilePath(filePath)) {
        testFiles.push(filePath);
      }
      if (isConfigOrSchemaPath(filePath)) {
        configAndSchemaFiles.push(filePath);
      }

      for (const sym of symbols) {
        if (relevantSymbols.length >= limits.maxSymbols) break;
        relevantSymbols.push({
          filePath,
          name: sym.name,
          kind: sym.kind,
          startLine: sym.startLine,
          endLine: sym.endLine,
          exported: sym.exported
        });
      }

      // Collect tight line-range evidence references (prefer matched/exported symbol ranges)
      if (evidenceReferences.length < limits.maxEvidenceRecords) {
        const primarySym =
          symbols.find((s) =>
            terms.some((t) => t.length >= 3 && s.name.toLowerCase().includes(t))
          ) ?? symbols.find((s) => s.exported);

        const startLine = primarySym ? Math.max(1, primarySym.startLine) : 1;
        const endLine = primarySym
          ? Math.min(
              lines.length,
              Math.max(startLine, Math.min(primarySym.endLine, startLine + 20))
            )
          : Math.min(lines.length, 20);
        const snippet = lines
          .slice(startLine - 1, endLine)
          .join("\n")
          .slice(0, 600);

        evidenceReferences.push({
          evidenceId: `ev-${crypto.createHash("sha1").update(`${filePath}:${startLine}-${endLine}`).digest("hex").slice(0, 10)}`,
          filePath,
          contentHash,
          startLine,
          endLine: Math.max(startLine, endLine),
          symbolName: primarySym?.name,
          snippet,
          reason: Array.from(meta.reasons).join(", ")
        });
      }
    }

    onProgress?.("preparing_report", "Finalizing reproducible investigation report.");
    const reproducibleInput = JSON.stringify({
      intentId: intent.intentId,
      normalizedGoal: intent.normalizedGoal,
      files: relevantFiles.map((f) => [f.filePath, f.contentHash])
    });
    const reproducibleHash = crypto.createHash("sha256").update(reproducibleInput).digest("hex");

    return InvestigationReportSchema.parse({
      investigationId: crypto.randomUUID(),
      intentId: intent.intentId,
      workspaceId: intent.workspaceId,
      relevantFiles,
      relevantSymbols,
      dependencyRelationships: relations,
      apiRelationships: apiLinks,
      testFiles,
      configAndSchemaFiles,
      evidenceReferences,
      missingContext,
      limitations,
      limitsApplied: limits,
      durationMs: Date.now() - startedAt,
      totalBytesInspected,
      reproducibleHash,
      createdAt: new Date().toISOString()
    });
  }
}
