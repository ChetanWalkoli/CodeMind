import {
  IMPACT_RISK_MODEL_VERSION,
  type ImpactApiContract,
  type ImpactChangeType,
  type ImpactCompleteness,
  type ImpactCoverage,
  type ImpactDatabaseContract,
  type ImpactDecisionRef,
  type ImpactedFile,
  type ImpactGraphEdge,
  type ImpactGraphNode,
  type ImpactRelationship,
  type ImpactRisk,
  type ImpactRiskFactor,
  type ImpactRiskLevel,
  type ImpactTestItem,
  type ImpactValidationStep
} from "@codemind/shared";

// ============================================================================
// Milestone 8.7 — Explainable Deterministic Risk Scoring (impact-risk-v1.0.0)
// ============================================================================

export interface RiskScoringInput {
  targetFiles: string[];
  changeType: ImpactChangeType;
  impactedFiles: ImpactedFile[];
  apiContracts: ImpactApiContract[];
  databaseContracts: ImpactDatabaseContract[];
  impactedTests: ImpactTestItem[];
  relatedDecisions: ImpactDecisionRef[];
  completeness: ImpactCompleteness;
  coverage: ImpactCoverage;
}

const CRITICAL_DOMAIN_REGEX =
  /(auth|security|crypto|token|jwt|session|permission|rbac|acl|payment|billing|migration|middleware|secret|vault)/i;
const CORE_SHARED_REGEX = /(schema|contract|core|shared|config|types|database|model|prisma)/i;

export function scoreToRiskLevel(score: number): ImpactRiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

export function calculateImpactRisk(input: RiskScoringInput): ImpactRisk {
  const factors: ImpactRiskFactor[] = [];

  // Deduplicate inputs so repeated dependencies or duplicate contract references never double-count
  const uniqueImpactedMap = new Map<string, ImpactedFile>();
  for (const f of input.impactedFiles) {
    const existing = uniqueImpactedMap.get(f.filePath);
    if (!existing || (existing.category !== "direct" && f.category === "direct")) {
      uniqueImpactedMap.set(f.filePath, f);
    }
  }
  const uniqueImpactedFiles = [...uniqueImpactedMap.values()];

  const uniqueApiMap = new Map<string, ImpactApiContract>();
  for (const c of input.apiContracts) {
    const key = `${c.method.toUpperCase()}:${c.endpoint}:${c.routeFile}`;
    if (!uniqueApiMap.has(key)) {
      uniqueApiMap.set(key, c);
    }
  }
  const uniqueApiContracts = [...uniqueApiMap.values()];

  const uniqueDbMap = new Map<string, ImpactDatabaseContract>();
  for (const d of input.databaseContracts) {
    const key = `${d.modelName}:${d.schemaFile}`;
    if (!uniqueDbMap.has(key)) {
      uniqueDbMap.set(key, d);
    }
  }
  const uniqueDbContracts = [...uniqueDbMap.values()];

  const uniqueTestMap = new Map<string, ImpactTestItem>();
  for (const t of input.impactedTests) {
    if (!uniqueTestMap.has(t.testFile)) {
      uniqueTestMap.set(t.testFile, t);
    }
  }
  const uniqueTests = [...uniqueTestMap.values()];

  const uniqueDecisionMap = new Map<string, ImpactDecisionRef>();
  for (const d of input.relatedDecisions) {
    if (!uniqueDecisionMap.has(d.decisionId)) {
      uniqueDecisionMap.set(d.decisionId, d);
    }
  }
  const uniqueDecisions = [...uniqueDecisionMap.values()];

  // Factor 1: Blast radius (direct + transitive dependents) — max 25
  const directFiles = uniqueImpactedFiles.filter((f) => f.category === "direct");
  const transitiveFiles = uniqueImpactedFiles.filter((f) => f.category === "transitive");
  const blastContribution = Math.min(
    25,
    Math.round(Math.min(16, directFiles.length * 4) + Math.min(9, transitiveFiles.length * 1.5))
  );
  factors.push({
    factorId: "blast_radius",
    label: "Dependency Blast Radius",
    contribution: blastContribution,
    maxContribution: 25,
    explanation: `${directFiles.length} direct dependent(s) and ${transitiveFiles.length} transitive dependent(s) identified.`,
    supportingEvidence: [...directFiles, ...transitiveFiles].slice(0, 6).map((f) => f.filePath)
  });

  // Factor 2: Change type severity — max 15
  const severityMap: Record<ImpactChangeType, number> = {
    file_deleted: 15,
    symbol_removed: 15,
    database_contract_changed: 15,
    api_contract_changed: 12,
    symbol_modified: 8,
    file_modified: 5,
    unknown: 5,
    file_created: 2,
    symbol_added: 2
  };
  const changeContribution = severityMap[input.changeType] ?? 5;
  factors.push({
    factorId: "change_severity",
    label: "Change Type Severity",
    contribution: changeContribution,
    maxContribution: 15,
    explanation: `Change classified as "${input.changeType}".`,
    supportingEvidence: [...new Set(input.targetFiles)].slice(0, 5)
  });

  // Factor 3: API Contract Exposure — max 15
  const uniqueFrontendConsumers = new Set<string>();
  for (const c of uniqueApiContracts) {
    for (const fc of c.frontendConsumers) {
      uniqueFrontendConsumers.add(fc.filePath);
    }
  }
  const totalFrontendConsumers = uniqueFrontendConsumers.size;
  const apiContribution = Math.min(15, uniqueApiContracts.length * 5 + totalFrontendConsumers * 3);
  factors.push({
    factorId: "api_contract_exposure",
    label: "API Contract & Consumer Exposure",
    contribution: apiContribution,
    maxContribution: 15,
    explanation:
      uniqueApiContracts.length > 0
        ? `${uniqueApiContracts.length} API endpoint(s) and ${totalFrontendConsumers} frontend consumer(s) are connected to this change.`
        : "No affected API endpoints were detected.",
    supportingEvidence: uniqueApiContracts
      .slice(0, 5)
      .map((c) => `${c.method} ${c.endpoint} (${c.routeFile})`)
  });

  // Factor 4: Database Contract Exposure — max 15
  const hasBreakingDbChange = uniqueDbContracts.some((db) =>
    db.detectedChanges.some(
      (ch) => ch === "field_removed" || ch === "field_type_changed" || ch === "requiredness_changed"
    )
  );
  const dbContribution = Math.min(15, uniqueDbContracts.length * 6 + (hasBreakingDbChange ? 5 : 0));
  factors.push({
    factorId: "database_contract_exposure",
    label: "Database & Persistence Schema Impact",
    contribution: dbContribution,
    maxContribution: 15,
    explanation:
      uniqueDbContracts.length > 0
        ? `${uniqueDbContracts.length} data model(s) impacted${hasBreakingDbChange ? " with potentially breaking field/type/requiredness changes" : ""}.`
        : "No database schema or model contracts were detected in the affected set.",
    supportingEvidence: uniqueDbContracts
      .slice(0, 5)
      .map((d) => `${d.modelName} (${d.technology}: ${d.schemaFile})`)
  });

  // Factor 5: Security & Core Path Sensitivity — max 10
  const sensitivityPool = [
    ...new Set([...input.targetFiles, ...directFiles.map((f) => f.filePath)])
  ];
  const criticalHits = sensitivityPool.filter((p) => CRITICAL_DOMAIN_REGEX.test(p));
  const coreHits = sensitivityPool.filter((p) => CORE_SHARED_REGEX.test(p));
  const sensitivityContribution = criticalHits.length > 0 ? 10 : coreHits.length > 0 ? 5 : 0;
  factors.push({
    factorId: "security_and_core_sensitivity",
    label: "Security & Core Architecture Sensitivity",
    contribution: sensitivityContribution,
    maxContribution: 10,
    explanation:
      criticalHits.length > 0
        ? `Touches sensitive security/auth/middleware/migration path(s): ${criticalHits.slice(0, 3).join(", ")}.`
        : coreHits.length > 0
          ? `Touches shared/core/schema path(s): ${coreHits.slice(0, 3).join(", ")}.`
          : "No security-critical or shared-core path indicators detected.",
    supportingEvidence: (criticalHits.length > 0 ? criticalHits : coreHits).slice(0, 5)
  });

  // Factor 6: Test Coverage Gap — max 10
  const definiteOrLikelyTests = uniqueTests.filter(
    (t) => t.classification === "definitely_affected" || t.classification === "likely_affected"
  );
  let testGapContribution = 0;
  let testGapExplanation = "";
  if (definiteOrLikelyTests.length === 0) {
    if (uniqueTests.length === 0) {
      testGapContribution =
        uniqueImpactedFiles.length > 0 ||
        uniqueApiContracts.length > 0 ||
        uniqueDbContracts.length > 0
          ? 10
          : 5;
      testGapExplanation =
        "No directly or likely affected automated tests were discovered for the analyzed targets.";
    } else {
      testGapContribution = 4;
      testGapExplanation =
        "Only heuristic additional test recommendations were found; no direct static test import was confirmed.";
    }
  } else {
    testGapContribution = 0;
    testGapExplanation = `${definiteOrLikelyTests.length} directly/likely affected test file(s) provide automated verification coverage.`;
  }
  factors.push({
    factorId: "test_coverage_gap",
    label: "Automated Test Coverage Gap",
    contribution: testGapContribution,
    maxContribution: 10,
    explanation: testGapExplanation,
    supportingEvidence: uniqueTests.slice(0, 5).map((t) => t.testFile)
  });

  // Factor 7: Decision Memory Alignment — max 10
  const conflictDecisions = uniqueDecisions.filter((d) => d.relation === "possible_conflict");
  const directOrStaleDecisions = uniqueDecisions.filter(
    (d) => d.relation === "directly_referenced" || d.relation === "stale_evidence"
  );
  const transitiveDecisions = uniqueDecisions.filter(
    (d) => d.relation === "transitively_related" || d.relation === "potentially_affected"
  );
  const decisionContribution =
    conflictDecisions.length > 0
      ? 10
      : directOrStaleDecisions.length > 0
        ? 6
        : transitiveDecisions.length > 0
          ? 3
          : 0;
  factors.push({
    factorId: "decision_memory_alignment",
    label: "Historical Decision Memory Alignment",
    contribution: decisionContribution,
    maxContribution: 10,
    explanation:
      conflictDecisions.length > 0
        ? `${conflictDecisions.length} recorded engineering decision(s) flagged for possible conflict review.`
        : directOrStaleDecisions.length > 0
          ? `${directOrStaleDecisions.length} recorded decision(s) directly reference affected files or have stale evidence.`
          : transitiveDecisions.length > 0
            ? `${transitiveDecisions.length} recorded decision(s) are transitively or potentially related.`
            : "No recorded engineering decisions reference the affected files.",
    supportingEvidence: uniqueDecisions.slice(0, 5).map((d) => `${d.title} (${d.relation})`)
  });

  const rawScore = factors.reduce((sum, f) => sum + f.contribution, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const rawLevel = scoreToRiskLevel(score);
  // Incomplete static analysis must never silently appear as "low" risk.
  const incompleteFloorApplied = input.completeness === "incomplete" && rawLevel === "low";
  const level: ImpactRiskLevel = incompleteFloorApplied ? "medium" : rawLevel;

  const uncertaintyNotes: string[] = [];
  if (input.completeness !== "complete") {
    uncertaintyNotes.push(
      `Analysis completeness is "${input.completeness}". Risk score reflects only statically observable evidence.`
    );
  }
  if (input.coverage.truncated) {
    uncertaintyNotes.push(
      `Traversal reached configured depth/file cap (${input.coverage.maxDepthConfigured} hops / ${input.coverage.traversedNodes} nodes); additional downstream impact may exist.`
    );
  }
  if (input.coverage.unresolvedImportCount > 0) {
    uncertaintyNotes.push(
      `${input.coverage.unresolvedImportCount} unresolved or dynamic import(s) could not be statically traced.`
    );
  }
  if (input.coverage.cyclesDetected > 0) {
    uncertaintyNotes.push(
      `${input.coverage.cyclesDetected} cyclic dependency edge(s) were detected and safely bounded.`
    );
  }

  const topContributors = [...factors]
    .filter((f) => f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((f) => `${f.label} (+${f.contribution})`);

  const explanation = incompleteFloorApplied
    ? `Risk rated MEDIUM (minimum floor due to incomplete analysis; observed factor score ${score}/100) using ${IMPACT_RISK_MODEL_VERSION}. Incomplete static coverage prevents certifying low risk.`
    : topContributors.length > 0
      ? `Risk rated ${level.toUpperCase()} (${score}/100) using ${IMPACT_RISK_MODEL_VERSION}. Primary drivers: ${topContributors.join(", ")}.`
      : `Risk rated LOW (${score}/100) using ${IMPACT_RISK_MODEL_VERSION}. No downstream dependents, contract changes, or decision conflicts were detected.`;

  return {
    score,
    level,
    calculationVersion: IMPACT_RISK_MODEL_VERSION,
    factors,
    explanation,
    uncertaintyNotes
  };
}

// ============================================================================
// Milestone 8.8 — Impact Graph Builder (for React Flow Visualization)
// ============================================================================

export interface BuildImpactGraphInput {
  targetFiles: string[];
  impactedFiles: ImpactedFile[];
  apiContracts: ImpactApiContract[];
  databaseContracts: ImpactDatabaseContract[];
  impactedTests: ImpactTestItem[];
  relatedDecisions: ImpactDecisionRef[];
  relationships: ImpactRelationship[];
  maxVisualNodes?: number;
}

function shortLabel(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  if (parts.length <= 2) return filePath;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function buildImpactGraph(input: BuildImpactGraphInput): {
  nodes: ImpactGraphNode[];
  edges: ImpactGraphEdge[];
} {
  const maxNodes = Math.max(15, Math.min(120, input.maxVisualNodes ?? 60));
  const nodeMap = new Map<string, ImpactGraphNode>();
  const edgeMap = new Map<string, ImpactGraphEdge>();

  const addNode = (node: ImpactGraphNode) => {
    if (nodeMap.has(node.id)) return;
    if (nodeMap.size >= maxNodes) return;
    nodeMap.set(node.id, node);
  };

  const addEdge = (edge: ImpactGraphEdge) => {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) return;
    if (edge.source === edge.target) return;
    const key = `${edge.source}|${edge.target}|${edge.relationshipType}`;
    if (edgeMap.has(key)) return;
    edgeMap.set(key, edge);
  };

  // 1. Target nodes
  for (const t of input.targetFiles) {
    addNode({
      id: `file:${t}`,
      label: shortLabel(t),
      filePath: t,
      kind: "target_file",
      depth: 0,
      category: "direct",
      badge: "TARGET"
    });
  }

  // 2. Database models
  for (const db of input.databaseContracts) {
    const dbNodeId = `db:${db.modelName}`;
    addNode({
      id: dbNodeId,
      label: `${db.modelName} (${db.technology})`,
      filePath: db.schemaFile,
      kind: "database_model",
      depth: 1,
      category: "direct",
      badge: "DB MODEL"
    });
    if (nodeMap.has(`file:${db.schemaFile}`)) {
      addEdge({
        id: `e-db-schema-${db.modelName}`,
        source: `file:${db.schemaFile}`,
        target: dbNodeId,
        relationshipType: "uses_model",
        confidence: "confirmed",
        label: "defines model"
      });
    }
  }

  // 3. Direct & transitive impacted files
  for (const imp of input.impactedFiles) {
    const kind =
      imp.category === "direct"
        ? "direct_dependent"
        : imp.category === "transitive"
          ? "transitive_dependent"
          : "potential_dependent";
    addNode({
      id: `file:${imp.filePath}`,
      label: shortLabel(imp.filePath),
      filePath: imp.filePath,
      kind,
      depth: imp.depth,
      category: imp.category,
      badge: imp.category === "direct" ? "DIRECT" : `DEPTH ${imp.depth}`
    });
  }

  // 4. API routes & frontend consumers
  for (const api of input.apiContracts) {
    const apiNodeId = `api:${api.method}:${api.endpoint}`;
    addNode({
      id: apiNodeId,
      label: `${api.method} ${api.endpoint}`,
      filePath: api.routeFile,
      kind: "api_route",
      depth: 2,
      category: "direct",
      badge: "API"
    });
    if (nodeMap.has(`file:${api.routeFile}`)) {
      addEdge({
        id: `e-route-${api.id}`,
        source: `file:${api.routeFile}`,
        target: apiNodeId,
        relationshipType: "implements_route",
        confidence: "confirmed",
        label: "implements"
      });
    }
    for (const consumer of api.frontendConsumers) {
      const cId = `file:${consumer.filePath}`;
      addNode({
        id: cId,
        label: shortLabel(consumer.filePath),
        filePath: consumer.filePath,
        kind: "frontend_consumer",
        depth: 3,
        category: "transitive",
        badge: "FRONTEND"
      });
      addEdge({
        id: `e-consume-${api.id}-${consumer.filePath}`,
        source: apiNodeId,
        target: cId,
        relationshipType: "consumes_api",
        confidence: consumer.confidence,
        label: "consumed by"
      });
    }
  }

  // 5. Impacted test files
  for (const test of input.impactedTests) {
    const tId = `test:${test.testFile}`;
    addNode({
      id: tId,
      label: shortLabel(test.testFile),
      filePath: test.testFile,
      kind: "test_file",
      depth: 2,
      category: test.classification === "definitely_affected" ? "direct" : "transitive",
      badge: test.classification === "definitely_affected" ? "TEST" : "LIKELY TEST"
    });
    const srcId = `file:${test.relatedSourceFile}`;
    if (nodeMap.has(srcId)) {
      addEdge({
        id: `e-test-${test.id}`,
        source: srcId,
        target: tId,
        relationshipType: "tests",
        confidence: test.classification === "definitely_affected" ? "confirmed" : "inferred",
        label: "tested by"
      });
    }
  }

  // 6. Related Decisions
  for (const dec of input.relatedDecisions) {
    const dId = `decision:${dec.decisionId}`;
    addNode({
      id: dId,
      label: dec.title.length > 36 ? `${dec.title.slice(0, 35)}…` : dec.title,
      filePath: dec.matchedFiles[0],
      kind: "decision",
      depth: 1,
      category:
        dec.relation === "directly_referenced" || dec.relation === "possible_conflict"
          ? "direct"
          : "potential",
      badge: dec.relation === "possible_conflict" ? "CONFLICT?" : "DECISION"
    });
    const anchorFile = dec.matchedFiles[0] ?? input.targetFiles[0];
    if (anchorFile && nodeMap.has(`file:${anchorFile}`)) {
      addEdge({
        id: `e-dec-${dec.decisionId}`,
        source: `file:${anchorFile}`,
        target: dId,
        relationshipType: "decision_references",
        confidence: dec.matchedFiles.length > 0 ? "confirmed" : "inferred",
        label: dec.relation.replace(/_/g, " ")
      });
    }
  }

  // 7. Wire dependency edges from relationships (sourceNode = upstream/target -> destinationNode = dependent)
  for (const rel of input.relationships) {
    if (
      rel.relationshipType === "imports" ||
      rel.relationshipType === "depends_on" ||
      rel.relationshipType === "possible_dependency"
    ) {
      addEdge({
        id: `e-rel-${rel.id}`,
        source: `file:${rel.sourceNode}`,
        target: `file:${rel.destinationNode}`,
        relationshipType: rel.relationshipType,
        confidence: rel.confidence,
        label: rel.relationshipType === "possible_dependency" ? "possible impact" : "imported by"
      });
    }
  }

  return {
    nodes: [...nodeMap.values()],
    edges: [...edgeMap.values()]
  };
}

// ============================================================================
// Milestone 8.9 — Validation Recommendations (Real Discovered Scripts Only)
// ============================================================================

export interface DiscoveredValidationCommand {
  id: string;
  label: string;
  command: string;
  category: "test" | "typecheck" | "lint" | "build";
}

export interface BuildValidationPlanInput {
  targetFiles: string[];
  impactedFiles: ImpactedFile[];
  apiContracts: ImpactApiContract[];
  databaseContracts: ImpactDatabaseContract[];
  impactedTests: ImpactTestItem[];
  relatedDecisions: ImpactDecisionRef[];
  discoveredCommands: DiscoveredValidationCommand[];
}

export function buildValidationPlan(input: BuildValidationPlanInput): ImpactValidationStep[] {
  const steps: ImpactValidationStep[] = [];
  const findCmd = (cat: DiscoveredValidationCommand["category"]) =>
    input.discoveredCommands.find((c) => c.category === cat) ?? null;

  const testCmd = findCmd("test");
  const typecheckCmd = findCmd("typecheck");
  const lintCmd = findCmd("lint");
  const buildCmd = findCmd("build");

  // 1. Targeted tests (critical/high)
  const definiteTests = input.impactedTests.filter(
    (t) => t.classification === "definitely_affected"
  );
  const likelyTests = input.impactedTests.filter((t) => t.classification === "likely_affected");

  if (definiteTests.length > 0 || likelyTests.length > 0) {
    const allRelatedTests = [...definiteTests, ...likelyTests].map((t) => t.testFile);
    steps.push({
      stepId: `val-${steps.length + 1}`,
      title: `Run affected test suite (${allRelatedTests.length} test file${allRelatedTests.length === 1 ? "" : "s"})`,
      description:
        testCmd !== null
          ? `Execute the workspace test script "${testCmd.command}" to verify ${definiteTests.length} definitely affected and ${likelyTests.length} likely affected test file(s).`
          : `No workspace test script was discovered in package.json. Manually run tests covering: ${allRelatedTests.slice(0, 4).join(", ")}.`,
      category: "unit_test",
      relatedFiles: input.targetFiles.slice(0, 10),
      relatedTests: allRelatedTests.slice(0, 20),
      recommendedCommand: testCmd?.command ?? null,
      commandId: testCmd?.id ?? null,
      priority: definiteTests.length > 0 ? "critical" : "high",
      reason: `${definiteTests.length} definitely affected and ${likelyTests.length} likely affected test(s) cover the changed targets.`,
      requiresUserApproval: true,
      executionStatus: "pending"
    });
  } else {
    steps.push({
      stepId: `val-${steps.length + 1}`,
      title: "Add or run manual test verification (no direct tests discovered)",
      description:
        testCmd !== null
          ? `No directly linked test files were discovered for the modified targets. Consider adding targeted tests and running "${testCmd.command}".`
          : "No directly linked test files or package.json test script were discovered. Perform targeted manual verification of modified behavior.",
      category: "manual_review",
      relatedFiles: input.targetFiles.slice(0, 10),
      relatedTests: [],
      recommendedCommand: testCmd?.command ?? null,
      commandId: testCmd?.id ?? null,
      priority: input.impactedFiles.length > 0 ? "high" : "medium",
      reason: "Automated test coverage for the analyzed targets could not be confirmed statically.",
      requiresUserApproval: true,
      executionStatus: "pending"
    });
  }

  // 2. Database contract validation
  if (input.databaseContracts.length > 0) {
    steps.push({
      stepId: `val-${steps.length + 1}`,
      title: `Verify database schema & model consumers (${input.databaseContracts.map((d) => d.modelName).join(", ")})`,
      description: `Inspect model consumers (${
        input.databaseContracts
          .flatMap((d) => d.consumerFiles)
          .slice(0, 5)
          .join(", ") || "none detected"
      }) and verify migration/backward-compatibility for field, type, or requiredness changes.`,
      category: "database_validation",
      relatedFiles: input.databaseContracts.map((d) => d.schemaFile),
      relatedTests: [],
      recommendedCommand: null,
      commandId: null,
      priority: "critical",
      reason: `Change impacts ${input.databaseContracts.length} persistence model(s).`,
      requiresUserApproval: true,
      executionStatus: "pending"
    });
  }

  // 3. API contract & frontend consumer validation
  if (input.apiContracts.length > 0) {
    const endpoints = input.apiContracts.slice(0, 4).map((c) => `${c.method} ${c.endpoint}`);
    const consumers = input.apiContracts.flatMap((c) =>
      c.frontendConsumers.map((fc) => fc.filePath)
    );
    steps.push({
      stepId: `val-${steps.length + 1}`,
      title: `Validate API contract compatibility (${endpoints.join(", ")})`,
      description:
        consumers.length > 0
          ? `Verify request/response payload compatibility between affected API route(s) and ${consumers.length} frontend consumer(s).`
          : `Verify request/response contract for ${endpoints.join(", ")}. External or untracked API clients may also depend on these routes.`,
      category: "api_validation",
      relatedFiles: [
        ...new Set([...input.apiContracts.map((c) => c.routeFile), ...consumers])
      ].slice(0, 15),
      relatedTests: [],
      recommendedCommand: null,
      commandId: null,
      priority: consumers.length > 0 ? "critical" : "high",
      reason: `${input.apiContracts.length} API route(s) lie in the impact chain.`,
      requiresUserApproval: true,
      executionStatus: "pending"
    });
  }

  // 4. Decision Memory review
  if (input.relatedDecisions.length > 0) {
    const hasConflict = input.relatedDecisions.some((d) => d.relation === "possible_conflict");
    steps.push({
      stepId: `val-${steps.length + 1}`,
      title: `Review ${input.relatedDecisions.length} related engineering decision${input.relatedDecisions.length === 1 ? "" : "s"}`,
      description: `Confirm whether this change aligns with or supersedes recorded Decision Memory entries (${input.relatedDecisions
        .slice(0, 3)
        .map((d) => d.title)
        .join("; ")}).`,
      category: "manual_review",
      relatedFiles: [...new Set(input.relatedDecisions.flatMap((d) => d.matchedFiles))].slice(
        0,
        10
      ),
      relatedTests: [],
      recommendedCommand: null,
      commandId: null,
      priority: hasConflict ? "critical" : "high",
      reason: hasConflict
        ? "One or more recorded decisions were flagged for possible conflict review."
        : "Recorded engineering decisions reference files in the impact scope.",
      requiresUserApproval: true,
      executionStatus: "pending"
    });
  }

  // 5. Typecheck (only if real script discovered)
  if (typecheckCmd) {
    steps.push({
      stepId: `val-${steps.length + 1}`,
      title: "Run static typecheck across workspace",
      description: `Run "${typecheckCmd.command}" to catch signature, import, or interface breakages across ${input.impactedFiles.length} impacted file(s).`,
      category: "typecheck",
      relatedFiles: input.targetFiles.slice(0, 10),
      relatedTests: [],
      recommendedCommand: typecheckCmd.command,
      commandId: typecheckCmd.id,
      priority: "high",
      reason: "Static type checking verifies cross-file symbol contracts.",
      requiresUserApproval: true,
      executionStatus: "pending"
    });
  }

  // 6. Build (only if real script discovered)
  if (buildCmd) {
    steps.push({
      stepId: `val-${steps.length + 1}`,
      title: "Run production build check",
      description: `Run "${buildCmd.command}" to verify bundling and module resolution succeed cleanly.`,
      category: "build",
      relatedFiles: input.targetFiles.slice(0, 10),
      relatedTests: [],
      recommendedCommand: buildCmd.command,
      commandId: buildCmd.id,
      priority: "medium",
      reason: "Build verification ensures downstream bundles compile without missing exports.",
      requiresUserApproval: true,
      executionStatus: "pending"
    });
  }

  // 7. Lint (only if real script discovered)
  if (lintCmd) {
    steps.push({
      stepId: `val-${steps.length + 1}`,
      title: "Run linter verification",
      description: `Run "${lintCmd.command}" to check static code quality rules on modified files.`,
      category: "lint",
      relatedFiles: input.targetFiles.slice(0, 10),
      relatedTests: [],
      recommendedCommand: lintCmd.command,
      commandId: lintCmd.id,
      priority: "low",
      reason: "Linting catches unused imports, shadow variables, and rule violations.",
      requiresUserApproval: true,
      executionStatus: "pending"
    });
  }

  // Sort by priority (critical -> high -> medium -> low)
  const priorityOrder: Record<ImpactValidationStep["priority"], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  };
  steps.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);

  return steps;
}
