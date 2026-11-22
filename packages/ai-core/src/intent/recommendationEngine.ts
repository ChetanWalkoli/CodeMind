import crypto from "node:crypto";
import {
  EngineeringRecommendationSchema,
  type AnalysisFinding,
  type AnalysisReport,
  type EngineeringRecommendation,
  type IntentRequest,
  type RecommendationCategory
} from "@codemind/shared";

const SEVERITY_WEIGHT: Record<AnalysisFinding["severity"], number> = {
  critical: 45,
  high: 35,
  medium: 22,
  low: 12,
  info: 5
};

const VERIFICATION_WEIGHT: Record<AnalysisFinding["verificationStatus"], number> = {
  verified: 25,
  inferred: 14,
  contradicted: 18,
  unknown: 4
};

const COMPLEXITY_PENALTY: Record<EngineeringRecommendation["implementationComplexity"], number> = {
  low: 0,
  medium: 6,
  high: 14
};

const RISK_PENALTY: Record<EngineeringRecommendation["estimatedRisk"], number> = {
  low: 0,
  medium: 5,
  high: 12
};

function mapFindingToCategory(finding: AnalysisFinding): RecommendationCategory {
  switch (finding.category) {
    case "root_cause":
    case "bug":
    case "contract_mismatch":
      return "correctness";
    case "security":
      return "security";
    case "performance":
      return "performance";
    case "architecture":
      return "architecture";
    case "maintainability":
      return "maintainability";
    case "testing_gap":
      return "testing";
    default:
      return "reliability";
  }
}

function scoreRecommendation(params: {
  severity: AnalysisFinding["severity"];
  verificationStatus: AnalysisFinding["verificationStatus"];
  evidenceCount: number;
  complexity: EngineeringRecommendation["implementationComplexity"];
  risk: EngineeringRecommendation["estimatedRisk"];
}): { score: number; factors: string[]; priority: EngineeringRecommendation["priority"] } {
  const sev = SEVERITY_WEIGHT[params.severity];
  const ver = VERIFICATION_WEIGHT[params.verificationStatus];
  const evBonus = Math.min(15, params.evidenceCount * 4);
  const compPen = COMPLEXITY_PENALTY[params.complexity];
  const riskPen = RISK_PENALTY[params.risk];

  const score = Math.max(1, sev + ver + evBonus - compPen - riskPen);
  const priority: EngineeringRecommendation["priority"] =
    score >= 65 ? "p0" : score >= 45 ? "p1" : score >= 25 ? "p2" : "p3";

  const factors = [
    `severity:${params.severity}(+${sev})`,
    `evidence:${params.verificationStatus}(+${ver})`,
    `refs:${params.evidenceCount}(+${evBonus})`,
    `complexity:${params.complexity}(-${compPen})`,
    `risk:${params.risk}(-${riskPen})`
  ];

  return { score, factors, priority };
}

/**
 * Deterministic, Evidence-Backed Recommendation Engine (Milestone 6.4).
 * Converts validated AnalysisReport findings into transparently ranked
 * EngineeringRecommendations.
 *
 * Approval of a recommendation (`approved_for_patch`) is strictly separate from
 * file modification approval (Milestone 6.7).
 */
export function generateDeterministicRecommendations(params: {
  intent: IntentRequest;
  analysis: AnalysisReport;
}): EngineeringRecommendation[] {
  const { intent, analysis } = params;
  const recommendations: EngineeringRecommendation[] = [];

  for (const finding of analysis.findings) {
    // Reject findings with zero verified/inferred evidence or no affected files
    if (finding.affectedFiles.length === 0) continue;
    if (finding.verificationStatus === "unknown" && finding.evidenceReferences.length === 0) {
      continue;
    }

    const category = mapFindingToCategory(finding);
    const complexity: EngineeringRecommendation["implementationComplexity"] =
      finding.affectedFiles.length > 3
        ? "high"
        : finding.affectedFiles.length > 1
          ? "medium"
          : "low";
    const risk: EngineeringRecommendation["estimatedRisk"] =
      finding.category === "security" || finding.category === "architecture"
        ? "medium"
        : finding.affectedFiles.length > 3
          ? "medium"
          : "low";

    const { score, factors, priority } = scoreRecommendation({
      severity: finding.severity,
      verificationStatus: finding.verificationStatus,
      evidenceCount: finding.evidenceReferences.length,
      complexity,
      risk
    });

    const idSeed = `${intent.intentId}:${finding.findingId}:${category}`;
    const recommendationId = `rec-${crypto.createHash("sha1").update(idSeed).digest("hex").slice(0, 10)}`;

    const isTestGap = finding.category === "testing_gap";
    const title = isTestGap
      ? `Add regression tests covering ${finding.affectedFiles[0]}`
      : `Address ${finding.category.replace(/_/g, " ")} in ${finding.affectedFiles[0]}`;

    const proposedSteps = isTestGap
      ? [
          `Add deterministic unit/integration tests targeting ${finding.affectedFiles.join(", ")}.`,
          "Mock external providers and verify both normal and error edge cases.",
          "Run the project test suite via Verification Engine."
        ]
      : [
          `Inspect verified evidence in ${finding.affectedFiles.join(", ")}.`,
          `Implement minimal, scoped changes addressing: ${intent.normalizedGoal}.`,
          "Review the unified diff in Monaco Diff Editor and verify with local tests/typecheck."
        ];

    const validationStrategy = isTestGap
      ? "Run discovered test runner and confirm new tests pass."
      : "Run typecheck, lint, and targeted unit/integration tests after patch application.";

    recommendations.push(
      EngineeringRecommendationSchema.parse({
        recommendationId,
        title,
        description: finding.description,
        rationale: finding.reasoning,
        category,
        linkedFindingIds: [finding.findingId],
        affectedFiles: finding.affectedFiles,
        priority,
        severity: finding.severity,
        expectedBenefit: isTestGap
          ? "Prevents regressions and provides verifiable safety before and after code changes."
          : `Resolves ${finding.severity}-severity ${finding.category.replace(/_/g, " ")} backed by source evidence.`,
        implementationComplexity: complexity,
        estimatedRisk: risk,
        dependencies: [],
        proposedSteps,
        validationStrategy,
        rankScore: score,
        rankingFactors: factors,
        decision: "pending",
        decisionNote: null
      })
    );
  }

  // Link testing recommendations as depending on primary implementation recommendations when both exist
  const primaryImpl = recommendations.find((r) => r.category !== "testing");
  if (primaryImpl) {
    for (const rec of recommendations) {
      if (rec.category === "testing" && rec.recommendationId !== primaryImpl.recommendationId) {
        rec.dependencies = [primaryImpl.recommendationId];
      }
    }
  }

  // Deterministic sort: rankScore DESC, priority ASC, recommendationId ASC
  return recommendations.sort(
    (a, b) =>
      b.rankScore - a.rankScore ||
      a.priority.localeCompare(b.priority) ||
      a.recommendationId.localeCompare(b.recommendationId)
  );
}
