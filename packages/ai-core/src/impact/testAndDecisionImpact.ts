import type {
  DecisionImpactRelation,
  DependencyGraphSnapshot,
  EngineeringDecision,
  ImpactApiContract,
  ImpactDatabaseContract,
  ImpactDecisionRef,
  ImpactedFile,
  ImpactEvidence,
  ImpactRelationship,
  ImpactTestClassification,
  ImpactTestItem
} from "@codemind/shared";

function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function getBaseStem(filePath: string): string {
  const name = normPath(filePath).split("/").pop() ?? filePath;
  return name
    .replace(/\.(test|spec)\.[^.]+$/i, "")
    .replace(/\.[^.]+$/, "")
    .toLowerCase();
}

export function isTestFilePath(filePath: string): boolean {
  const n = normPath(filePath).toLowerCase();
  return (
    /(^|\/)(__tests__|tests|test|spec|specs)\//.test(n) || /\.(test|spec)\.[a-z0-9]+$/i.test(n)
  );
}

// ============================================================================
// Milestone 8.5 — Test Impact Detection
// ============================================================================

export interface TestImpactInput {
  targetFiles: string[];
  impactedFiles: ImpactedFile[];
  allIndexedFiles: string[];
  graph: DependencyGraphSnapshot;
  apiContracts?: ImpactApiContract[];
  databaseContracts?: ImpactDatabaseContract[];
}

export interface TestImpactOutput {
  impactedTests: ImpactTestItem[];
  relationships: ImpactRelationship[];
  evidence: ImpactEvidence[];
  limitations: string[];
}

export function analyzeTestImpact(input: TestImpactInput): TestImpactOutput {
  const targetSet = new Set(input.targetFiles.map(normPath));
  const impactedByPath = new Map<string, ImpactedFile>();
  for (const f of input.impactedFiles) {
    impactedByPath.set(normPath(f.filePath), f);
  }

  // Build reverse adjacency (imported -> importers)
  const reverseAdj = new Map<string, Set<string>>();
  for (const edge of input.graph.edges) {
    const src = normPath(edge.sourceId);
    const tgt = normPath(edge.targetId);
    let set = reverseAdj.get(tgt);
    if (!set) {
      set = new Set();
      reverseAdj.set(tgt, set);
    }
    set.add(src);
  }

  const allTestFiles = new Set<string>();
  for (const f of input.allIndexedFiles) {
    const n = normPath(f);
    if (isTestFilePath(n)) allTestFiles.add(n);
  }
  for (const node of input.graph.nodes) {
    const n = normPath(node.path);
    if (isTestFilePath(n)) allTestFiles.add(n);
  }

  const testItemsByPath = new Map<string, ImpactTestItem>();
  const relationships: ImpactRelationship[] = [];
  const evidence: ImpactEvidence[] = [];
  const limitations: string[] = [];

  const rankOf = (c: ImpactTestClassification): number =>
    c === "definitely_affected" ? 3 : c === "likely_affected" ? 2 : 1;

  const upsertTest = (
    testFile: string,
    item: Omit<ImpactTestItem, "id" | "evidenceIds">,
    ev: Omit<ImpactEvidence, "evidenceId">,
    sourceForRel: string
  ) => {
    const existing = testItemsByPath.get(testFile);
    if (existing && rankOf(existing.classification) >= rankOf(item.classification)) {
      return;
    }

    const evId = `ev-test-${evidence.length + 1}`;
    evidence.push({
      evidenceId: evId,
      ...ev
    });

    testItemsByPath.set(testFile, {
      id: `test-${testItemsByPath.size + 1}`,
      ...item,
      evidenceIds: [evId]
    });

    relationships.push({
      id: `rel-test-${relationships.length + 1}`,
      sourceNode: testFile,
      destinationNode: sourceForRel,
      relationshipType: "tests",
      depth: Math.max(1, item.dependencyPath.length - 1),
      evidenceId: evId,
      provenance: ev.provenance,
      confidence: item.classification === "definitely_affected" ? "confirmed" : "inferred",
      explanation: item.reason
    });
  };

  // 1. Direct test importers of target files -> definitely_affected
  for (const target of targetSet) {
    const importers = reverseAdj.get(target) ?? new Set<string>();
    for (const importer of importers) {
      if (!isTestFilePath(importer)) continue;
      upsertTest(
        importer,
        {
          testFile: importer,
          relatedSourceFile: target,
          dependencyPath: [target, importer],
          classification: "definitely_affected",
          priority: "critical",
          reason: `Test file "${importer}" directly imports modified target "${target}".`
        },
        {
          filePath: importer,
          evidenceType: "test_import",
          provenance: "confirmed_static",
          verificationStatus: "current",
          explanation: `Direct static import from test "${importer}" to target "${target}".`
        },
        target
      );
    }
  }

  // 2. Test files that appear in impactedFiles (transitive dependents) or directly import an impacted file -> likely_affected
  for (const imp of input.impactedFiles) {
    const impPath = normPath(imp.filePath);
    if (isTestFilePath(impPath) && !targetSet.has(impPath)) {
      const path = imp.pathsFromTarget[0] ?? [input.targetFiles[0] ?? impPath, impPath];
      const classification: ImpactTestClassification =
        imp.depth <= 1 ? "definitely_affected" : "likely_affected";
      upsertTest(
        impPath,
        {
          testFile: impPath,
          relatedSourceFile: path[0] ?? impPath,
          dependencyPath: path,
          classification,
          priority: classification === "definitely_affected" ? "critical" : "high",
          reason:
            classification === "definitely_affected"
              ? `Test file "${impPath}" directly depends on target "${path[0] ?? impPath}".`
              : `Test file "${impPath}" transitively depends on target "${path[0] ?? impPath}" (depth ${imp.depth}).`
        },
        {
          filePath: impPath,
          evidenceType: "test_import",
          provenance: "confirmed_static",
          verificationStatus: "current",
          explanation: `Dependency path from target to test: ${path.join(" -> ")}.`
        },
        path[0] ?? impPath
      );
      continue;
    }

    // Check test files directly importing this impacted source file
    const importers = reverseAdj.get(impPath) ?? new Set<string>();
    for (const importer of importers) {
      if (!isTestFilePath(importer)) continue;
      const basePath = imp.pathsFromTarget[0] ?? [input.targetFiles[0] ?? impPath, impPath];
      const fullPath = [...basePath, importer];
      upsertTest(
        importer,
        {
          testFile: importer,
          relatedSourceFile: impPath,
          dependencyPath: fullPath,
          classification: "likely_affected",
          priority: "high",
          reason: `Test file "${importer}" imports impacted dependent "${impPath}".`
        },
        {
          filePath: importer,
          evidenceType: "test_import",
          provenance: "confirmed_static",
          verificationStatus: "current",
          explanation: `Test "${importer}" covers impacted file "${impPath}".`
        },
        impPath
      );
    }
  }

  // 3. Naming convention heuristic match for targets (when not already linked by static import)
  const targetStems = new Map<string, string>();
  for (const t of targetSet) {
    const stem = getBaseStem(t);
    if (stem.length >= 3 && stem !== "index" && stem !== "page" && stem !== "route") {
      targetStems.set(stem, t);
    }
  }

  for (const testFile of allTestFiles) {
    if (testItemsByPath.has(testFile)) continue;
    const testStem = getBaseStem(testFile);
    const matchedTarget = targetStems.get(testStem);
    if (matchedTarget) {
      upsertTest(
        testFile,
        {
          testFile,
          relatedSourceFile: matchedTarget,
          dependencyPath: [matchedTarget, testFile],
          classification: "likely_affected",
          priority: "medium",
          reason: `Test filename "${testFile}" matches modified target "${matchedTarget}" by naming convention (static import not observed).`
        },
        {
          filePath: testFile,
          evidenceType: "test_import",
          provenance: "heuristic",
          verificationStatus: "unverified",
          explanation: `Filename stem match ("${testStem}") between test and target.`
        },
        matchedTarget
      );
    }
  }

  // 4. Recommended additional tests matching affected API/DB contract domain tokens
  const domainTokens = new Set<string>();
  for (const api of input.apiContracts ?? []) {
    const segments = api.endpoint
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((s) => s.length >= 3 && s !== "api" && s !== "v1" && s !== "v2");
    for (const s of segments) domainTokens.add(s);
  }
  for (const db of input.databaseContracts ?? []) {
    const token = db.modelName.toLowerCase();
    if (token.length >= 3) domainTokens.add(token);
  }

  if (domainTokens.size > 0) {
    for (const testFile of allTestFiles) {
      if (testItemsByPath.has(testFile)) continue;
      const lower = testFile.toLowerCase();
      for (const token of domainTokens) {
        if (lower.includes(token)) {
          const fallbackTarget = input.targetFiles[0] ?? testFile;
          upsertTest(
            testFile,
            {
              testFile,
              relatedSourceFile: fallbackTarget,
              dependencyPath: [fallbackTarget, testFile],
              classification: "recommended_additional",
              priority: "medium",
              reason: `Test file "${testFile}" matches impacted contract domain "${token}" and is recommended as additional verification.`
            },
            {
              filePath: testFile,
              evidenceType: "test_import",
              provenance: "heuristic",
              verificationStatus: "unverified",
              explanation: `Contract domain token "${token}" matched test file path.`
            },
            fallbackTarget
          );
          break;
        }
      }
    }
  }

  const impactedTests = [...testItemsByPath.values()].sort((a, b) => {
    const diff = rankOf(b.classification) - rankOf(a.classification);
    if (diff !== 0) return diff;
    return a.testFile.localeCompare(b.testFile);
  });

  if (impactedTests.length === 0) {
    limitations.push(
      "No directly related test was discovered for the analyzed targets. Manual testing or adding targeted unit/integration tests is recommended."
    );
  }

  return {
    impactedTests,
    relationships,
    evidence,
    limitations
  };
}

// ============================================================================
// Milestone 8.6 — Decision Memory Relationship Analysis
// ============================================================================

export interface DecisionImpactInput {
  decisions: EngineeringDecision[];
  targetFiles: string[];
  impactedFiles: ImpactedFile[];
  changeType: string;
  apiContracts?: ImpactApiContract[];
  databaseContracts?: ImpactDatabaseContract[];
}

export interface DecisionImpactOutput {
  relatedDecisions: ImpactDecisionRef[];
  relationships: ImpactRelationship[];
  evidence: ImpactEvidence[];
}

export function analyzeDecisionImpact(input: DecisionImpactInput): DecisionImpactOutput {
  const targetSet = new Set(input.targetFiles.map(normPath));
  const impactedSet = new Set(input.impactedFiles.map((f) => normPath(f.filePath)));

  const isBreakingChangeType =
    input.changeType === "file_deleted" ||
    input.changeType === "symbol_removed" ||
    input.changeType === "api_contract_changed" ||
    input.changeType === "database_contract_changed";

  const hasBreakingDbChange = (input.databaseContracts ?? []).some((db) =>
    db.detectedChanges.some(
      (c) => c === "field_removed" || c === "field_type_changed" || c === "requiredness_changed"
    )
  );

  // Domain keywords for soft matching (potentially_affected)
  const contractKeywords = new Set<string>();
  for (const api of input.apiContracts ?? []) {
    contractKeywords.add(api.endpoint.toLowerCase());
  }
  for (const db of input.databaseContracts ?? []) {
    if (db.modelName.length >= 3) {
      contractKeywords.add(db.modelName.toLowerCase());
    }
  }

  const relatedDecisions: ImpactDecisionRef[] = [];
  const relationships: ImpactRelationship[] = [];
  const evidence: ImpactEvidence[] = [];

  for (const decision of input.decisions) {
    const decisionFiles = new Set<string>();
    for (const ev of decision.evidence ?? []) {
      if (ev.filePath) decisionFiles.add(normPath(ev.filePath));
    }
    for (const gitRef of decision.gitReferences ?? []) {
      for (const f of gitRef.changedFiles ?? []) {
        decisionFiles.add(normPath(f));
      }
    }

    const directMatches: string[] = [];
    const transitiveMatches: string[] = [];

    for (const f of decisionFiles) {
      if (targetSet.has(f)) {
        directMatches.push(f);
      } else if (impactedSet.has(f)) {
        transitiveMatches.push(f);
      }
    }

    const hasStaleEvidence =
      decision.verificationStatus === "stale" ||
      (decision.evidence ?? []).some((e) => e.verificationStatus === "stale");

    let relation: DecisionImpactRelation = "unrelated";
    let matchedFiles: string[] = [];
    let explanation = "";

    if (directMatches.length > 0) {
      matchedFiles = directMatches;
      if (
        decision.verificationStatus === "needs_review" ||
        isBreakingChangeType ||
        hasBreakingDbChange
      ) {
        relation = "possible_conflict";
        explanation = `Possible conflict — review recommended: decision "${decision.title}" directly references modified target(s) (${directMatches.join(", ")}) and this change involves a potentially breaking or contract-level modification.`;
      } else if (hasStaleEvidence) {
        relation = "stale_evidence";
        explanation = `Decision "${decision.title}" directly references ${directMatches.join(", ")}, and its linked evidence is marked stale — revalidation is recommended.`;
      } else {
        relation = "directly_referenced";
        explanation = `Decision "${decision.title}" directly references modified target file(s): ${directMatches.join(", ")}. Review recommended to ensure alignment.`;
      }
    } else if (transitiveMatches.length > 0) {
      matchedFiles = transitiveMatches;
      if (hasStaleEvidence) {
        relation = "stale_evidence";
        explanation = `Decision "${decision.title}" references transitively impacted file(s) (${transitiveMatches.slice(0, 3).join(", ")}) and has stale evidence — review recommended.`;
      } else {
        relation = "transitively_related";
        explanation = `Decision "${decision.title}" references transitively impacted file(s): ${transitiveMatches.slice(0, 3).join(", ")}.`;
      }
    } else if (contractKeywords.size > 0) {
      const searchableText = [
        decision.title,
        decision.summary,
        decision.context,
        decision.decision,
        ...(decision.tags ?? [])
      ]
        .join(" ")
        .toLowerCase();

      const matchedKeyword = [...contractKeywords].find((kw) => searchableText.includes(kw));
      if (matchedKeyword) {
        relation = "potentially_affected";
        explanation = `Decision "${decision.title}" mentions affected contract/model term "${matchedKeyword}" without an explicit file link — review recommended.`;
      }
    }

    if (relation === "unrelated") continue;

    const evId = `ev-dec-${evidence.length + 1}`;
    evidence.push({
      evidenceId: evId,
      filePath: matchedFiles[0] ?? input.targetFiles[0] ?? "decision-memory",
      evidenceType: "decision_evidence",
      provenance: "decision_memory",
      verificationStatus: hasStaleEvidence ? "stale" : "current",
      explanation
    });

    relatedDecisions.push({
      decisionId: decision.id,
      title: decision.title,
      category: decision.category,
      status: decision.status,
      verificationStatus: decision.verificationStatus,
      provenance: decision.confidence,
      relation,
      matchedFiles,
      explanation
    });

    relationships.push({
      id: `rel-dec-${relationships.length + 1}`,
      sourceNode: `decision:${decision.id}`,
      destinationNode: matchedFiles[0] ?? input.targetFiles[0] ?? "workspace",
      relationshipType: "decision_references",
      depth: directMatches.length > 0 ? 1 : 2,
      evidenceId: evId,
      provenance: "decision_memory",
      confidence: directMatches.length > 0 ? "confirmed" : "inferred",
      explanation
    });
  }

  // Prioritize possible_conflict -> directly_referenced -> stale_evidence -> transitively_related -> potentially_affected
  const order: Record<DecisionImpactRelation, number> = {
    possible_conflict: 5,
    directly_referenced: 4,
    stale_evidence: 3,
    transitively_related: 2,
    potentially_affected: 1,
    unrelated: 0
  };
  relatedDecisions.sort((a, b) => order[b.relation] - order[a.relation]);

  return {
    relatedDecisions,
    relationships,
    evidence
  };
}
