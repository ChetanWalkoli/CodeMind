import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  analyzeApiContractImpact,
  analyzeDatabaseContractImpact,
  analyzeDecisionImpact,
  analyzeDependencyImpact,
  analyzeTestImpact,
  buildImpactGraph,
  buildValidationPlan,
  calculateImpactRisk,
  type ApiRelationshipInput,
  type DiscoveredValidationCommand,
  type FileMetadataForImpact
} from "@codemind/ai-core";
import {
  CodeEngineIgnore,
  computeHash,
  isSecretFilePath,
  ProjectIndexer
} from "@codemind/code-engine";
import {
  IMPACT_SCHEMA_VERSION,
  ImpactAnalysisResultSchema,
  type ImpactAnalysisRequest,
  type ImpactAnalysisResult,
  type ImpactAnalysisSummary,
  type ImpactCompleteness,
  type ImpactValidationStepStatus
} from "@codemind/shared";
import type { DecisionManager } from "../decisions/decisionManager.js";
import type { VerificationEngine } from "../intent/verificationEngine.js";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";
import {
  getBaselineFileContent,
  getUncommittedChangedFiles,
  isBinaryBuffer
} from "./impactGitDiffService.js";
import type { ImpactStore } from "./impactStore.js";

const MAX_READ_BYTES = 256 * 1024;
const MAX_GIT_DIFF_TARGETS = 20;

export class ImpactSecurityError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ImpactSecurityError";
    this.code = code;
  }
}

function normRelPath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

function workspaceIdFor(workspaceRoot: string): string {
  return crypto.createHash("sha256").update(workspaceRoot.toLowerCase()).digest("hex").slice(0, 16);
}

function isSensitiveImpactPath(relPath: string): boolean {
  if (isSecretFilePath(relPath)) return true;
  const lower = relPath.toLowerCase();
  const base = path.posix.basename(lower);
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(base)) return true;
  if (/(^|\/)(secrets?|credentials?)(\.|\/|$)/i.test(lower)) return true;
  if (base === "id_rsa" || base === "id_ed25519") return true;
  return false;
}

/**
 * TOCTOU-safe, bounded, binary-aware file reader.
 * Opens the target file descriptor once, verifies regular file + size via fstat on the open fd,
 * rejects binary files (NUL byte detection), and closes the descriptor unconditionally.
 */
function safeReadFileFd(absPath: string): {
  content: string | null;
  exists: boolean;
  isBinary: boolean;
  tooLarge: boolean;
} {
  let fd: number | null = null;
  try {
    fd = fs.openSync(absPath, "r");
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      return { content: null, exists: true, isBinary: false, tooLarge: false };
    }
    if (stat.size > MAX_READ_BYTES) {
      return { content: null, exists: true, isBinary: false, tooLarge: true };
    }
    const buf = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      const n = fs.readSync(fd, buf, offset, stat.size - offset, offset);
      if (n <= 0) break;
      offset += n;
    }
    const slice = buf.subarray(0, offset);
    if (isBinaryBuffer(slice)) {
      return { content: null, exists: true, isBinary: true, tooLarge: false };
    }
    return { content: slice.toString("utf8"), exists: true, isBinary: false, tooLarge: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { content: null, exists: false, isBinary: false, tooLarge: false };
    }
    return { content: null, exists: false, isBinary: false, tooLarge: false };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close error
      }
    }
  }
}

export interface ImpactManagerDeps {
  workspaceAuthority: WorkspaceAuthority;
  impactStore: ImpactStore;
  decisionManager?: DecisionManager;
  verificationEngine?: VerificationEngine;
  getIndexer?: (workspaceRoot: string) => ProjectIndexer | null;
}

export class ImpactManager {
  private readonly workspaceAuthority: WorkspaceAuthority;
  private readonly impactStore: ImpactStore;
  private readonly decisionManager?: DecisionManager;
  private readonly verificationEngine?: VerificationEngine;
  private readonly getIndexer?: (workspaceRoot: string) => ProjectIndexer | null;

  constructor(deps: ImpactManagerDeps) {
    this.workspaceAuthority = deps.workspaceAuthority;
    this.impactStore = deps.impactStore;
    this.decisionManager = deps.decisionManager;
    this.verificationEngine = deps.verificationEngine;
    this.getIndexer = deps.getIndexer;
  }

  private resolveTargetSafely(
    workspaceRoot: string,
    rawFilePath: string,
    ignore: CodeEngineIgnore
  ): {
    relPath: string;
    absPath: string;
  } {
    const normalized = normRelPath(rawFilePath);
    if (!normalized || normalized.includes("\0")) {
      throw new ImpactSecurityError("INVALID_PATH", "Target file path is empty or invalid.");
    }
    if (isSensitiveImpactPath(normalized)) {
      throw new ImpactSecurityError(
        "SENSITIVE_FILE_BLOCKED",
        `Sensitive or secret file "${normalized}" is blocked from Change Impact analysis.`
      );
    }
    if (ignore.shouldIgnore(normalized, false)) {
      throw new ImpactSecurityError(
        "IGNORED_FILE_BLOCKED",
        `Ignored file "${normalized}" is excluded from Change Impact analysis.`
      );
    }

    let absPath: string;
    try {
      absPath = this.workspaceAuthority.resolveSafePath(workspaceRoot, normalized);
    } catch {
      throw new ImpactSecurityError(
        "WORKSPACE_ESCAPE_BLOCKED",
        `Target path "${rawFilePath}" resolves outside the authorized workspace boundary.`
      );
    }

    return { relPath: normalized, absPath };
  }

  private async ensureIndexer(workspaceRoot: string): Promise<ProjectIndexer> {
    const existing = this.getIndexer?.(workspaceRoot) ?? null;
    if (existing && existing.getAllFilePaths().length > 0) {
      await existing.syncWorkspace();
      return existing;
    }
    const fresh = new ProjectIndexer(workspaceRoot);
    await fresh.indexWorkspace();
    return fresh;
  }

  public async analyzeChangeImpact(
    request: ImpactAnalysisRequest,
    extraLimitations: string[] = []
  ): Promise<ImpactAnalysisResult> {
    const startMs = Date.now();
    const realRoot = this.workspaceAuthority.getAuthorizedRoot(request.workspaceRoot);
    const wsId = workspaceIdFor(realRoot);
    const ignore = CodeEngineIgnore.fromWorkspace(realRoot);
    const limitations: string[] = [...extraLimitations];

    // 1. Validate all requested targets against workspace boundary, ignore rules, and secret exclusion
    const validatedTargets: Array<{
      filePath: string;
      absPath: string;
      symbolName?: string;
      beforeContent?: string;
      afterContent?: string;
      currentContent?: string;
      sourceHash?: string;
      existsOnDisk: boolean;
    }> = [];

    for (const t of request.targets) {
      const { relPath, absPath } = this.resolveTargetSafely(realRoot, t.filePath, ignore);
      const readRes = safeReadFileFd(absPath);
      if (readRes.isBinary) {
        limitations.push(
          `Binary file "${relPath}" cannot be statically parsed for code or schema changes.`
        );
      } else if (readRes.tooLarge) {
        limitations.push(
          `File "${relPath}" exceeds ${Math.round(MAX_READ_BYTES / 1024)}KB read limit; content-level contract diffing was skipped.`
        );
      }
      const currentContent = readRes.content ?? undefined;
      const effectiveContent = t.afterContent ?? currentContent;
      const sourceHash = effectiveContent ? computeHash(effectiveContent) : undefined;

      validatedTargets.push({
        filePath: relPath,
        absPath,
        symbolName: t.symbolName,
        beforeContent: t.beforeContent,
        afterContent: t.afterContent,
        currentContent,
        sourceHash,
        existsOnDisk: readRes.exists
      });
    }

    // 2. Ensure Code Engine index is available
    const indexer = await this.ensureIndexer(realRoot);
    const graph = indexer.getGraphSnapshot();
    const allIndexedFiles = indexer.getAllFilePaths();

    const fileMetaByPath = new Map<string, FileMetadataForImpact>();
    for (const fPath of allIndexedFiles) {
      const entry = indexer.getFileEntry(fPath);
      if (entry) {
        fileMetaByPath.set(fPath, {
          filePath: entry.node.path,
          language: entry.node.language,
          sourceHash: entry.node.contentHash,
          imports: entry.imports,
          symbols: entry.symbols
        });
      }
    }

    // 3. Milestones 8.2 & 8.3 — Direct & Transitive Dependency Analysis
    const depOut = analyzeDependencyImpact({
      targetFiles: validatedTargets.map((t) => ({
        filePath: t.filePath,
        symbolName: t.symbolName
      })),
      graph,
      fileMetaByPath,
      maxDepth: request.maxDepth,
      maxAffectedFiles: request.maxAffectedFiles
    });

    if (depOut.missingTargetNodes.length > 0) {
      limitations.push(
        `Target file(s) not present in dependency graph (${depOut.missingTargetNodes.slice(0, 5).join(", ")}); static dependents could not be traced for unindexed/non-JS targets.`
      );
    }
    if (depOut.truncated) {
      limitations.push(
        `Dependency traversal was capped at ${request.maxAffectedFiles} affected files (max depth ${request.maxDepth}). Additional downstream dependents may exist.`
      );
    }
    if (depOut.unresolvedImportCount > 0) {
      limitations.push(
        `${depOut.unresolvedImportCount} relative/dynamic import(s) across indexed files could not be statically resolved.`
      );
    }
    if (depOut.cyclesDetected > 0) {
      limitations.push(
        `${depOut.cyclesDetected} cyclic dependency edge(s) were detected and safely bounded during traversal.`
      );
    }

    // 4. Milestone 8.4A — API Contract Impact
    const targetFilePaths = validatedTargets.map((t) => t.filePath);
    const affectedBackendAndTargetFiles = new Set<string>([
      ...targetFilePaths,
      ...depOut.impactedFiles.map((f) => f.filePath)
    ]);

    const rawApiRels = indexer.getApiRelationships();
    const apiRelInputs: ApiRelationshipInput[] = rawApiRels.map((r) => ({
      method: r.method,
      endpoint: r.endpoint,
      callerFile: r.callerFile,
      callerLine: r.callerLine,
      handlerFile: r.handlerFile,
      handlerLine: r.handlerLine,
      confidence: r.confidence,
      explanation: `${r.method} ${r.endpoint} (${r.callerFile} -> ${r.handlerFile})`
    }));

    const apiOut = analyzeApiContractImpact({
      affectedBackendAndTargetFiles,
      apiRelationships: apiRelInputs
    });

    // 5. Milestone 8.4B — Database Contract Impact
    const consumerFilesByTarget = new Map<string, string[]>();
    for (const target of validatedTargets) {
      const directConsumers = depOut.impactedFiles
        .filter(
          (f) => f.category === "direct" && f.pathsFromTarget.some((p) => p[0] === target.filePath)
        )
        .map((f) => f.filePath);
      consumerFilesByTarget.set(target.filePath, directConsumers);
    }

    const dbContracts = analyzeDatabaseContractImpact({
      targets: validatedTargets.map((t) => ({
        filePath: t.filePath,
        currentContent: t.currentContent,
        beforeContent: t.beforeContent,
        afterContent: t.afterContent
      })),
      consumerFilesByTarget
    });

    // 6. Milestone 8.5 — Test Impact Detection (Never auto-runs tests)
    const testOut = analyzeTestImpact({
      targetFiles: targetFilePaths,
      impactedFiles: depOut.impactedFiles,
      allIndexedFiles,
      graph,
      apiContracts: apiOut.apiContracts,
      databaseContracts: dbContracts
    });
    limitations.push(...testOut.limitations);

    // 7. Milestone 8.6 — Decision Memory Relationship Analysis (Read-only, never mutates decisions)
    const workspaceDecisions = this.decisionManager
      ? this.decisionManager.listDecisions(realRoot)
      : [];

    const decisionOut = analyzeDecisionImpact({
      decisions: workspaceDecisions,
      targetFiles: targetFilePaths,
      impactedFiles: depOut.impactedFiles,
      changeType: request.changeType,
      apiContracts: apiOut.apiContracts,
      databaseContracts: dbContracts
    });

    // 8. Combine relationships & evidence
    const allRelationships = [
      ...depOut.relationships,
      ...apiOut.relationships,
      ...testOut.relationships,
      ...decisionOut.relationships
    ];
    const rawEvidence = [
      ...depOut.evidence,
      ...apiOut.evidence,
      ...testOut.evidence,
      ...decisionOut.evidence
    ];
    const hashCache = new Map<string, string | undefined>();
    const getEvidenceFileHash = (relPath: string): string | undefined => {
      if (hashCache.has(relPath)) return hashCache.get(relPath);
      const indexedHash = fileMetaByPath.get(relPath)?.sourceHash;
      if (indexedHash) {
        hashCache.set(relPath, indexedHash);
        return indexedHash;
      }
      if (!relPath || relPath === "decision-memory" || isSensitiveImpactPath(relPath)) {
        hashCache.set(relPath, undefined);
        return undefined;
      }
      try {
        const abs = this.workspaceAuthority.resolveSafePath(realRoot, relPath);
        const r = safeReadFileFd(abs);
        const h = r.content !== null ? computeHash(r.content) : undefined;
        hashCache.set(relPath, h);
        return h;
      } catch {
        hashCache.set(relPath, undefined);
        return undefined;
      }
    };
    const allEvidence = rawEvidence.map((ev) =>
      ev.sourceHash ? ev : { ...ev, sourceHash: getEvidenceFileHash(ev.filePath) }
    );

    // 9. Completeness assessment
    const anyMissingTarget = validatedTargets.some((t) => !t.existsOnDisk && !t.afterContent);
    let completeness: ImpactCompleteness = "complete";
    let completenessReason =
      "Static dependency graph, API contracts, database models, tests, and Decision Memory were analyzed.";

    if (anyMissingTarget || allIndexedFiles.length === 0) {
      completeness = "incomplete";
      completenessReason =
        "One or more target files were missing on disk or workspace index had zero indexed files.";
    } else if (
      depOut.truncated ||
      depOut.unresolvedImportCount > 0 ||
      depOut.missingTargetNodes.length > 0
    ) {
      completeness = "partial";
      completenessReason =
        "Static analysis completed with partial coverage due to traversal bounds, unindexed target nodes, or unresolved/dynamic imports.";
    }

    const durationMs = Math.max(1, Date.now() - startMs);
    const coverage = {
      totalIndexedFiles: allIndexedFiles.length,
      traversedNodes: depOut.traversedNodes,
      maxDepthConfigured: request.maxDepth,
      maxDepthReached: depOut.maxDepthReached,
      truncated: depOut.truncated,
      unresolvedImportCount: depOut.unresolvedImportCount,
      cyclesDetected: depOut.cyclesDetected,
      durationMs
    };

    // 10. Milestone 8.7 — Deterministic Explainable Risk Scoring
    const risk = calculateImpactRisk({
      targetFiles: targetFilePaths,
      changeType: request.changeType,
      impactedFiles: depOut.impactedFiles,
      apiContracts: apiOut.apiContracts,
      databaseContracts: dbContracts,
      impactedTests: testOut.impactedTests,
      relatedDecisions: decisionOut.relatedDecisions,
      completeness,
      coverage
    });

    // 11. Milestone 8.8 — Impact Graph
    const { nodes: graphNodes, edges: graphEdges } = buildImpactGraph({
      targetFiles: targetFilePaths,
      impactedFiles: depOut.impactedFiles,
      apiContracts: apiOut.apiContracts,
      databaseContracts: dbContracts,
      impactedTests: testOut.impactedTests,
      relatedDecisions: decisionOut.relatedDecisions,
      relationships: allRelationships
    });

    // 12. Milestone 8.9 — Validation Plan (Real discovered scripts only, never auto-executed)
    const discoveredCommands: DiscoveredValidationCommand[] = [];
    if (this.verificationEngine) {
      const candidates = this.verificationEngine.discoverCommands(realRoot);
      for (const c of candidates) {
        if (
          c.safe &&
          (c.kind === "test" || c.kind === "typecheck" || c.kind === "lint" || c.kind === "build")
        ) {
          discoveredCommands.push({
            id: c.commandId,
            label: c.label,
            command: c.displayCommand,
            category: c.kind
          });
        }
      }
    }

    const validationPlan = buildValidationPlan({
      targetFiles: targetFilePaths,
      impactedFiles: depOut.impactedFiles,
      apiContracts: apiOut.apiContracts,
      databaseContracts: dbContracts,
      impactedTests: testOut.impactedTests,
      relatedDecisions: decisionOut.relatedDecisions,
      discoveredCommands
    });

    const analysisId = `imp-${crypto.randomBytes(6).toString("hex")}`;
    const result: ImpactAnalysisResult = ImpactAnalysisResultSchema.parse({
      analysisId,
      schemaVersion: IMPACT_SCHEMA_VERSION,
      workspaceId: wsId,
      status: completeness === "complete" ? "completed" : "partial",
      completeness,
      completenessReason,
      changeType: request.changeType,
      analyzedTargets: validatedTargets.map((t) => ({
        filePath: t.filePath,
        symbolName: t.symbolName,
        sourceHash: t.sourceHash,
        existsOnDisk: t.existsOnDisk
      })),
      impactedFiles: depOut.impactedFiles,
      impactedSymbols: depOut.impactedSymbols,
      apiContracts: apiOut.apiContracts,
      databaseContracts: dbContracts,
      impactedTests: testOut.impactedTests,
      relatedDecisions: decisionOut.relatedDecisions,
      relationships: allRelationships,
      evidence: allEvidence,
      graphNodes,
      graphEdges,
      risk,
      validationPlan,
      coverage,
      limitations,
      staleFiles: [],
      createdAt: new Date().toISOString()
    });

    this.impactStore.save(realRoot, result);

    console.info(
      `[CodeMind Impact] analysisId=${analysisId} targets=${targetFilePaths.length} impacted=${result.impactedFiles.length} tests=${result.impactedTests.length} decisions=${result.relatedDecisions.length} risk=${result.risk.level}(${result.risk.score}) durationMs=${durationMs}`
    );

    return result;
  }

  public async analyzeGitDiff(params: {
    workspaceRoot: string;
    maxDepth?: number;
    maxAffectedFiles?: number;
  }): Promise<{ available: boolean; reason?: string; result: ImpactAnalysisResult | null }> {
    const realRoot = this.workspaceAuthority.getAuthorizedRoot(params.workspaceRoot);
    const diff = await getUncommittedChangedFiles(realRoot);
    if (!diff.available) {
      return { available: false, reason: diff.reason, result: null };
    }

    const ignore = CodeEngineIgnore.fromWorkspace(realRoot);
    const extraLimitations: string[] = [];

    let skippedSensitiveOrIgnored = 0;
    const eligible = diff.changedFiles.filter((f) => {
      if (isSensitiveImpactPath(f.filePath) || ignore.shouldIgnore(f.filePath, false)) {
        skippedSensitiveOrIgnored += 1;
        return false;
      }
      return true;
    });

    if (skippedSensitiveOrIgnored > 0) {
      extraLimitations.push(
        `${skippedSensitiveOrIgnored} sensitive or ignored file(s) in Git status were excluded from impact analysis.`
      );
    }

    if (eligible.length === 0) {
      return {
        available: true,
        reason: "No uncommitted non-sensitive workspace changes were found in Git status.",
        result: null
      };
    }

    if (eligible.length > MAX_GIT_DIFF_TARGETS) {
      extraLimitations.push(
        `Git diff contained ${eligible.length} eligible changed files; analysis was bounded to the first ${MAX_GIT_DIFF_TARGETS} targets.`
      );
    }

    const safeChanged = eligible.slice(0, MAX_GIT_DIFF_TARGETS);

    const targets = await Promise.all(
      safeChanged.map(async (f) => {
        const baseline = await getBaselineFileContent(realRoot, f);
        if (baseline.isBinary) {
          extraLimitations.push(
            `Git baseline for binary file "${f.filePath}" was skipped for text/schema diffing.`
          );
        } else if (baseline.truncated) {
          extraLimitations.push(
            `Git baseline for large file "${f.filePath}" exceeded 120KB and was omitted from schema diffing.`
          );
        }
        return {
          filePath: f.filePath,
          beforeContent: baseline.content ?? undefined
        };
      })
    );

    const hasDeleted = safeChanged.some((f) => f.status === "deleted");
    const allCreated = safeChanged.every((f) => f.status === "added" || f.status === "untracked");
    const changeType = hasDeleted ? "file_deleted" : allCreated ? "file_created" : "file_modified";

    const result = await this.analyzeChangeImpact(
      {
        workspaceRoot: realRoot,
        targets,
        changeType,
        maxDepth: params.maxDepth ?? 3,
        maxAffectedFiles: params.maxAffectedFiles ?? 50,
        includeGitDiff: true
      },
      extraLimitations
    );

    return { available: true, result };
  }

  public getAnalysis(workspaceRoot: string, analysisId: string): ImpactAnalysisResult | null {
    const realRoot = this.workspaceAuthority.getAuthorizedRoot(workspaceRoot);
    return this.impactStore.get(realRoot, analysisId);
  }

  public listAnalyses(workspaceRoot: string, limit = 25): ImpactAnalysisSummary[] {
    const realRoot = this.workspaceAuthority.getAuthorizedRoot(workspaceRoot);
    return this.impactStore.listSummaries(realRoot, limit);
  }

  public deleteAnalysis(workspaceRoot: string, analysisId: string): boolean {
    const realRoot = this.workspaceAuthority.getAuthorizedRoot(workspaceRoot);
    return this.impactStore.delete(realRoot, analysisId);
  }

  public checkFreshness(workspaceRoot: string, analysisId: string): ImpactAnalysisResult | null {
    const realRoot = this.workspaceAuthority.getAuthorizedRoot(workspaceRoot);
    const existing = this.impactStore.get(realRoot, analysisId);
    if (!existing) return null;

    const staleFiles: string[] = [];
    const checkedHashes = new Map<string, string | null>();

    const checkFileHash = (relPath: string, expectedHash: string | undefined): void => {
      if (!expectedHash || !relPath || relPath === "decision-memory") return;
      let currentHash = checkedHashes.get(relPath);
      if (currentHash === undefined) {
        try {
          const abs = this.workspaceAuthority.resolveSafePath(realRoot, relPath);
          const readRes = safeReadFileFd(abs);
          currentHash = readRes.content !== null ? computeHash(readRes.content) : null;
        } catch {
          currentHash = null;
        }
        checkedHashes.set(relPath, currentHash);
      }
      if (currentHash === null || currentHash !== expectedHash) {
        staleFiles.push(relPath);
      }
    };

    // 1. Analyzed targets (including deletions of previously existing targets)
    for (const target of existing.analyzedTargets) {
      checkFileHash(target.filePath, target.sourceHash);
    }

    // 2. Direct & transitive impacted files
    for (const imp of existing.impactedFiles) {
      checkFileHash(imp.filePath, imp.sourceHash);
    }

    // 3. All evidence files (API routes/consumers, impacted tests, decision evidence files)
    for (const ev of existing.evidence) {
      checkFileHash(ev.filePath, ev.sourceHash);
    }

    // 4. Decision Memory mutations or deletions since report creation
    if (this.decisionManager && existing.relatedDecisions.length > 0) {
      const currentDecisions = this.decisionManager.listDecisions(realRoot);
      const byId = new Map(currentDecisions.map((d) => [d.id, d]));
      for (const ref of existing.relatedDecisions) {
        const current = byId.get(ref.decisionId);
        if (!current || current.updatedAt > existing.createdAt) {
          staleFiles.push(`decision:${ref.decisionId}`);
        }
      }
    }

    const uniqueStale = [...new Set(staleFiles)];
    const restoredStatus = existing.completeness === "complete" ? "completed" : "partial";
    const updated: ImpactAnalysisResult = {
      ...existing,
      status:
        uniqueStale.length > 0
          ? "stale"
          : existing.status === "stale"
            ? restoredStatus
            : existing.status,
      staleFiles: uniqueStale
    };

    return this.impactStore.save(realRoot, updated);
  }

  public updateValidationStep(
    workspaceRoot: string,
    analysisId: string,
    stepId: string,
    executionStatus: ImpactValidationStepStatus
  ): ImpactAnalysisResult | null {
    const realRoot = this.workspaceAuthority.getAuthorizedRoot(workspaceRoot);
    const existing = this.impactStore.get(realRoot, analysisId);
    if (!existing) return null;

    let matched = false;
    const nextPlan = existing.validationPlan.map((step) => {
      if (step.stepId === stepId) {
        matched = true;
        return { ...step, executionStatus };
      }
      return step;
    });

    if (!matched) return existing;

    return this.impactStore.save(realRoot, {
      ...existing,
      validationPlan: nextPlan
    });
  }
}
