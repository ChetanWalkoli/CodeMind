import { describe, expect, it } from "vitest";
import type { AnalysisFinding, InvestigationReport } from "@codemind/shared";
import {
  applyIntentClarifications,
  applyUnifiedDiff,
  assertIntentStatusTransition,
  buildUnifiedDiff,
  computeContentSha256,
  detectPatchConflicts,
  generateDeterministicRecommendations,
  IntentStateTransitionError,
  parseIntentDeterministic,
  runDeterministicAnalysis,
  sanitizeAndVerifyFindings,
  validatePatchStructure
} from "../index.js";

function makeInvestigation(intentId: string): InvestigationReport {
  const hashA = computeContentSha256("export function login() { return false; }\n");
  return {
    investigationId: "inv-1",
    intentId,
    workspaceId: "ws-1",
    relevantFiles: [
      {
        filePath: "backend/services/authService.ts",
        language: "typescript",
        role: "backend-implementation",
        contentHash: hashA,
        lineCount: 25,
        relevanceScore: 95,
        reasons: ["symbol-match"]
      }
    ],
    relevantSymbols: [
      {
        filePath: "backend/services/authService.ts",
        name: "authenticateUser",
        kind: "function",
        startLine: 1,
        endLine: 12,
        exported: true
      }
    ],
    dependencyRelationships: [],
    apiRelationships: [
      {
        method: "POST",
        endpoint: "/api/auth/login",
        callerFile: "frontend/lib/api.ts",
        callerLine: 10,
        handlerFile: "backend/services/authService.ts",
        handlerLine: 5,
        confidence: "inferred",
        explanation: "Inferred endpoint match"
      }
    ],
    testFiles: [],
    configAndSchemaFiles: [],
    evidenceReferences: [
      {
        evidenceId: "ev-1",
        filePath: "backend/services/authService.ts",
        contentHash: hashA,
        startLine: 1,
        endLine: 12,
        symbolName: "authenticateUser",
        snippet: "export function authenticateUser() {}",
        reason: "Primary symbol match"
      }
    ],
    missingContext: [],
    limitations: [],
    limitsApplied: {
      maxFiles: 20,
      maxGraphDepth: 2,
      maxSymbols: 80,
      maxEvidenceRecords: 60,
      maxContextBytes: 128 * 1024
    },
    durationMs: 12,
    totalBytesInspected: 420,
    reproducibleHash: "rep-hash-1",
    createdAt: new Date().toISOString()
  };
}

describe("Phase 6 Core — Intent Understanding, Analysis, Recommendations & Patch Engine", () => {
  it("6.1 classifies specific intents, flags ambiguous broad prompts, handles clarification, and blocks invalid transitions", () => {
    const specific = parseIntentDeterministic({
      workspaceId: "ws-1",
      prompt: "Fix the login error when a user enters an incorrect password."
    });
    expect(specific.intentType).toBe("bug_fix");
    expect(specific.ambiguity.isAmbiguous).toBe(false);
    expect(specific.status).toBe("ready_for_investigation");
    expect(specific.acceptanceCriteria.some((c) => c.source === "user")).toBe(true);
    expect(specific.acceptanceCriteria.some((c) => c.source === "inferred" && !c.confirmed)).toBe(
      true
    );

    const broad = parseIntentDeterministic({
      workspaceId: "ws-1",
      prompt: "Make the application faster."
    });
    expect(broad.intentType).toBe("performance");
    expect(broad.ambiguity.isAmbiguous).toBe(true);
    expect(broad.status).toBe("clarification_required");
    expect(broad.clarificationQuestions.length).toBeGreaterThan(0);

    const unknown = parseIntentDeterministic({
      workspaceId: "ws-1",
      prompt: "quantum banana"
    });
    expect(unknown.intentType).toBe("unknown");
    expect(unknown.ambiguity.isAmbiguous).toBe(true);

    const clarified = applyIntentClarifications(
      broad,
      { [broad.clarificationQuestions[0]!.id]: "Optimize backend quiz service latency" },
      ["ac-inferred-1"]
    );
    expect(clarified.status).toBe("ready_for_investigation");
    expect(clarified.ambiguity.isAmbiguous).toBe(false);
    expect(clarified.affectedAreas).toContain("backend");
    expect(clarified.affectedAreas).toContain("quiz");

    // Invalid state transition must throw
    expect(() => assertIntentStatusTransition("draft", "completed")).toThrow(
      IntentStateTransitionError
    );
    expect(() => assertIntentStatusTransition("cancelled", "investigating")).toThrow(
      IntentStateTransitionError
    );
    expect(() =>
      assertIntentStatusTransition("ready_for_investigation", "investigating")
    ).not.toThrow();
  });

  it("6.3 validates evidence references, rejects invented lines/files, and detects contradictions", () => {
    const intent = parseIntentDeterministic({
      workspaceId: "ws-1",
      prompt: "Fix the login error when a user enters an incorrect password."
    });
    const inv = makeInvestigation(intent.intentId);

    const badFindings: AnalysisFinding[] = [
      {
        findingId: "f-bad-line",
        title: "Out of bounds line claim",
        description: "Claims bug on line 999",
        category: "bug",
        severity: "high",
        confidence: "high",
        evidenceReferences: [
          {
            evidenceId: "ev-bad",
            filePath: "backend/services/authService.ts",
            contentHash: inv.relevantFiles[0]!.contentHash,
            startLine: 990,
            endLine: 999,
            snippet: "fake",
            reason: "invented"
          }
        ],
        affectedFiles: ["backend/services/authService.ts"],
        reasoning: "invented",
        verificationStatus: "verified"
      },
      {
        findingId: "f-bad-file",
        title: "Fabricated file claim",
        description: "Points to missing file",
        category: "bug",
        severity: "high",
        confidence: "high",
        evidenceReferences: [],
        affectedFiles: ["backend/nonexistent.ts"],
        reasoning: "invented",
        verificationStatus: "verified"
      }
    ];

    const sanitized = sanitizeAndVerifyFindings(badFindings, inv);
    expect(sanitized.accepted).toHaveLength(0);
    expect(sanitized.rejectedReasons.length).toBeGreaterThanOrEqual(2);

    const report = runDeterministicAnalysis({
      intent,
      investigation: inv,
      aiFindings: badFindings
    });
    expect(report.findings.length).toBeGreaterThanOrEqual(1);
    expect(report.findings.some((f) => f.verificationStatus === "verified")).toBe(true);
    expect(report.contradictions.length).toBe(1); // inferred API contract flagged
    expect(report.missingEvidence.length).toBeGreaterThanOrEqual(2);
  });

  it("6.4 produces deterministically ranked recommendations linked to evidence and dependencies", () => {
    const intent = parseIntentDeterministic({
      workspaceId: "ws-1",
      prompt: "Fix the login error when a user enters an incorrect password."
    });
    const inv = makeInvestigation(intent.intentId);
    const analysis = runDeterministicAnalysis({ intent, investigation: inv });

    const recsA = generateDeterministicRecommendations({ intent, analysis });
    const recsB = generateDeterministicRecommendations({ intent, analysis });

    expect(recsA).toEqual(recsB);
    expect(recsA.length).toBeGreaterThanOrEqual(2);
    expect(recsA[0]!.rankScore).toBeGreaterThanOrEqual(recsA[1]!.rankScore);
    expect(recsA.every((r) => r.decision === "pending")).toBe(true);

    const testRec = recsA.find((r) => r.category === "testing");
    expect(testRec?.dependencies.length).toBe(1);
  });

  it("6.5 builds and strictly verifies unified diffs, rejecting malformed, oversized, binary, and conflicting patches", () => {
    const orig = "line 1\nline 2\nline 3\nline 4\n";
    const prop = "line 1\nline 2 updated\nline 3\nline 4\nline 5\n";

    const diff = buildUnifiedDiff("src/demo.ts", orig, prop);
    expect(diff.addedLines).toBe(2);
    expect(diff.removedLines).toBe(1);

    const applied = applyUnifiedDiff(orig, diff.unifiedDiff);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.content).toBe(prop);
    }

    const validCheck = validatePatchStructure({
      targetFile: "src/demo.ts",
      originalContent: orig,
      proposedContent: prop,
      unifiedDiff: diff.unifiedDiff,
      addedLines: diff.addedLines,
      removedLines: diff.removedLines
    });
    expect(validCheck.valid).toBe(true);

    // Malformed diff rejected
    const malformed = applyUnifiedDiff(orig, "not a unified diff");
    expect(malformed.ok).toBe(false);

    // Binary NUL content rejected
    const binaryCheck = validatePatchStructure({
      targetFile: "src/demo.ts",
      originalContent: orig,
      proposedContent: "abc\0def",
      unifiedDiff: diff.unifiedDiff,
      addedLines: 1,
      removedLines: 1
    });
    expect(binaryCheck.valid).toBe(false);

    // Oversized patch rejected
    const oversizedCheck = validatePatchStructure({
      targetFile: "src/demo.ts",
      originalContent: orig,
      proposedContent: prop,
      unifiedDiff: diff.unifiedDiff,
      addedLines: diff.addedLines,
      removedLines: diff.removedLines,
      maxPatchBytes: 10
    });
    expect(oversizedCheck.valid).toBe(false);

    // Overlapping conflict detection
    const conflicts = detectPatchConflicts([
      {
        patchId: "p1",
        targetFile: "src/demo.ts",
        changedLineRanges: [{ startLine: 1, endLine: 5 }]
      },
      {
        patchId: "p2",
        targetFile: "src/demo.ts",
        changedLineRanges: [{ startLine: 4, endLine: 8 }]
      }
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reason).toContain("Overlapping");
  });
});
