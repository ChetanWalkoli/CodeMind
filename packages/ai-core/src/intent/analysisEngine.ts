import crypto from "node:crypto";
import {
  AnalysisReportSchema,
  type AnalysisContradiction,
  type AnalysisFinding,
  type AnalysisReport,
  type EvidenceVerificationStatus,
  type IntentFindingCategory,
  type IntentFindingSeverity,
  type IntentRequest,
  type InvestigationEvidenceRef,
  type InvestigationReport
} from "@codemind/shared";

export interface SourceValidationIndex {
  files: Map<string, { lineCount: number; contentHash: string }>;
}

/**
 * Validates that every evidence reference in a finding points to a real investigated
 * file with matching hash and valid in-bounds 1-based line range.
 * Rejects fabricated paths and invented line numbers deterministically.
 */
export function validateEvidenceReference(
  ref: InvestigationEvidenceRef,
  index: SourceValidationIndex
): { valid: boolean; reason?: string } {
  const fileInfo = index.files.get(ref.filePath);
  if (!fileInfo) {
    return { valid: false, reason: `File "${ref.filePath}" is not in the investigated workspace.` };
  }
  if (ref.contentHash !== fileInfo.contentHash) {
    return { valid: false, reason: `Stale content hash for "${ref.filePath}".` };
  }
  if (
    ref.startLine < 1 ||
    ref.endLine < ref.startLine ||
    ref.endLine > Math.max(1, fileInfo.lineCount)
  ) {
    return {
      valid: false,
      reason: `Line range ${ref.startLine}-${ref.endLine} is out of bounds for "${ref.filePath}" (${fileInfo.lineCount} lines).`
    };
  }
  return { valid: true };
}

export function buildSourceValidationIndex(report: InvestigationReport): SourceValidationIndex {
  const files = new Map<string, { lineCount: number; contentHash: string }>();
  for (const file of report.relevantFiles) {
    files.set(file.filePath, {
      lineCount: file.lineCount,
      contentHash: file.contentHash
    });
  }
  return { files };
}

/**
 * Validates candidate findings (e.g. from Gemini or heuristics) against actual
 * investigated files and rejects unsupported claims or invalid line references.
 */
export function sanitizeAndVerifyFindings(
  candidates: AnalysisFinding[],
  investigation: InvestigationReport
): { accepted: AnalysisFinding[]; rejectedReasons: string[] } {
  const index = buildSourceValidationIndex(investigation);
  const accepted: AnalysisFinding[] = [];
  const rejectedReasons: string[] = [];

  for (const finding of candidates) {
    const validRefs: InvestigationEvidenceRef[] = [];
    for (const ref of finding.evidenceReferences) {
      const check = validateEvidenceReference(ref, index);
      if (check.valid) {
        validRefs.push(ref);
      } else {
        rejectedReasons.push(`Rejected reference in "${finding.title}": ${check.reason}`);
      }
    }

    const validAffectedFiles = finding.affectedFiles.filter((f) => index.files.has(f));

    // A "verified" finding MUST have at least one validated evidence reference
    if (finding.verificationStatus === "verified" && validRefs.length === 0) {
      rejectedReasons.push(
        `Downgraded/rejected unsupported verified claim "${finding.title}" with no valid source evidence.`
      );
      continue;
    }

    if (validAffectedFiles.length === 0 && validRefs.length === 0) {
      rejectedReasons.push(
        `Rejected finding "${finding.title}" referencing no investigated files.`
      );
      continue;
    }

    accepted.push({
      ...finding,
      evidenceReferences: validRefs,
      affectedFiles:
        validAffectedFiles.length > 0
          ? validAffectedFiles
          : Array.from(new Set(validRefs.map((r) => r.filePath)))
    });
  }

  return { accepted, rejectedReasons };
}

/**
 * Deterministic Evidence-Based Analysis Engine (Milestone 6.3).
 * Produces source-backed findings, verified facts, hypotheses, contradictions,
 * missing evidence, and risk observations strictly grounded in the InvestigationReport.
 */
export function runDeterministicAnalysis(params: {
  intent: IntentRequest;
  investigation: InvestigationReport;
  aiFindings?: AnalysisFinding[];
  aiSummary?: string;
  aiHypotheses?: string[];
  usedAiReasoning?: boolean;
}): AnalysisReport {
  const { intent, investigation } = params;
  const now = new Date().toISOString();
  const index = buildSourceValidationIndex(investigation);

  const findings: AnalysisFinding[] = [];
  const verifiedFacts: string[] = [];
  const hypotheses: string[] = [...(params.aiHypotheses ?? [])];
  const missingEvidence: string[] = [...investigation.missingContext];
  const contradictions: AnalysisContradiction[] = [];
  const riskObservations: string[] = [];

  // 1. Verified facts from deterministic investigation
  if (investigation.relevantFiles.length > 0) {
    verifiedFacts.push(
      `Investigated ${investigation.relevantFiles.length} relevant workspace file(s) and ${investigation.relevantSymbols.length} symbol(s).`
    );
  } else {
    missingEvidence.push("No matching non-secret workspace files were discovered for this intent.");
  }

  if (investigation.apiRelationships.length > 0) {
    verifiedFacts.push(
      `Traced ${investigation.apiRelationships.length} cross-layer HTTP API relationship(s) connecting frontend callers to backend handlers.`
    );
  }

  // 2. Testing gap observation (deterministic)
  if (
    investigation.relevantFiles.length > 0 &&
    investigation.testFiles.length === 0 &&
    intent.intentType !== "documentation"
  ) {
    const primaryFile = investigation.relevantFiles[0]!;
    const matchingEvidence = investigation.evidenceReferences.filter(
      (e) => e.filePath === primaryFile.filePath
    );
    const validEvidence = matchingEvidence.filter((e) => validateEvidenceReference(e, index).valid);

    if (validEvidence.length > 0) {
      findings.push({
        findingId: `find-test-gap-${crypto.createHash("sha1").update(primaryFile.filePath).digest("hex").slice(0, 8)}`,
        title: "No automated test files discovered for investigated module",
        description: `The investigation located ${investigation.relevantFiles.length} implementation file(s) (starting with ${primaryFile.filePath}) but found no matching test files in the dependency neighborhood.`,
        category: "testing_gap",
        severity:
          intent.intentType === "bug_fix" || intent.intentType === "security" ? "high" : "medium",
        confidence: "high",
        evidenceReferences: validEvidence.slice(0, 2),
        affectedFiles: [primaryFile.filePath],
        reasoning:
          "Deterministic scan of investigated files and reverse dependents found zero test files.",
        verificationStatus: "verified"
      });
      riskObservations.push(
        "Modifying implementation files without existing automated tests increases regression risk."
      );
    }
  }

  // 3. Contradiction detection: inferred/ambiguous API contracts or missing backend handlers
  for (const api of investigation.apiRelationships) {
    if (api.confidence === "inferred") {
      const callerEvidence = investigation.evidenceReferences.filter(
        (e) => e.filePath === api.callerFile
      );
      contradictions.push({
        id: `contra-api-${crypto.createHash("sha1").update(`${api.callerFile}:${api.endpoint}`).digest("hex").slice(0, 8)}`,
        description: `API contract between ${api.callerFile}:${api.callerLine} and ${api.handlerFile}:${api.handlerLine} (${api.method} ${api.endpoint}) is inferred rather than confirmed.`,
        filesInvolved: [api.callerFile, api.handlerFile],
        evidenceReferences: callerEvidence.slice(0, 2)
      });
    }
  }

  // 4. Primary implementation finding anchored to top evidence references
  if (investigation.evidenceReferences.length > 0) {
    const topRefs = investigation.evidenceReferences
      .filter((ref) => validateEvidenceReference(ref, index).valid)
      .slice(0, 4);

    if (topRefs.length > 0) {
      const categoryMap: Record<IntentRequest["intentType"], IntentFindingCategory> = {
        bug_fix: "root_cause",
        security: "security",
        performance: "performance",
        optimization: "performance",
        refactor: "maintainability",
        architecture_change: "architecture",
        testing: "testing_gap",
        feature: "observation",
        code_explanation: "observation",
        documentation: "observation",
        unknown: "observation"
      };
      const severityMap: Record<IntentRequest["intentType"], IntentFindingSeverity> = {
        security: "high",
        bug_fix: "high",
        performance: "medium",
        optimization: "medium",
        architecture_change: "medium",
        refactor: "low",
        feature: "medium",
        testing: "medium",
        code_explanation: "info",
        documentation: "low",
        unknown: "info"
      };

      const affected = Array.from(new Set(topRefs.map((r) => r.filePath)));
      const status: EvidenceVerificationStatus =
        investigation.missingContext.length > 0 ? "inferred" : "verified";

      findings.push({
        findingId: `find-primary-${crypto.createHash("sha1").update(affected.join("|")).digest("hex").slice(0, 8)}`,
        title: `Primary implementation surface for "${intent.normalizedGoal.slice(0, 72)}"`,
        description: `Verified source implementation across ${affected.join(", ")} matching the requested ${intent.intentType.replace(/_/g, " ")} scope.`,
        category: categoryMap[intent.intentType],
        severity: severityMap[intent.intentType],
        confidence: status === "verified" ? "high" : "medium",
        evidenceReferences: topRefs,
        affectedFiles: affected,
        reasoning: `Selected from ${investigation.relevantFiles.length} investigated files via symbol, dependency, and API relationship tracing.`,
        verificationStatus: status
      });
    }
  }

  // 5. Merge optional AI-generated findings AFTER strict deterministic reference validation
  if (params.aiFindings && params.aiFindings.length > 0) {
    const { accepted, rejectedReasons } = sanitizeAndVerifyFindings(
      params.aiFindings,
      investigation
    );
    findings.push(...accepted);
    for (const reason of rejectedReasons) {
      missingEvidence.push(reason);
    }
  }

  if (investigation.limitations.length > 0) {
    riskObservations.push(...investigation.limitations);
  }

  const summary =
    params.aiSummary?.trim() ||
    `Analyzed ${investigation.relevantFiles.length} file(s), ${investigation.relevantSymbols.length} symbol(s), and ${investigation.evidenceReferences.length} evidence reference(s) for ${intent.intentType.replace(/_/g, " ")} intent. Produced ${findings.length} finding(s) and ${contradictions.length} contradiction(s).`;

  return AnalysisReportSchema.parse({
    analysisId: crypto.randomUUID(),
    intentId: intent.intentId,
    investigationId: investigation.investigationId,
    summary,
    findings,
    verifiedFacts,
    hypotheses,
    missingEvidence: Array.from(new Set(missingEvidence)),
    contradictions,
    riskObservations: Array.from(new Set(riskObservations)),
    usedAiReasoning: Boolean(params.usedAiReasoning),
    createdAt: now
  });
}
