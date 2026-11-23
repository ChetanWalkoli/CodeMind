import { describe, expect, it } from "vitest";
import type { DependencyGraphSnapshot, EngineeringDecision } from "@codemind/shared";
import {
  analyzeApiContractImpact,
  analyzeDatabaseContractImpact,
  analyzeDecisionImpact,
  analyzeDependencyImpact,
  analyzeTestImpact,
  buildImpactGraph,
  buildValidationPlan,
  calculateImpactRisk,
  diffDatabaseFields,
  extractDatabaseFieldsFromSource,
  scoreToRiskLevel
} from "../index.js";

function makeGraph(): DependencyGraphSnapshot {
  const now = new Date().toISOString();
  return {
    generatedAt: now,
    nodes: [
      {
        id: "backend/models/User.js",
        path: "backend/models/User.js",
        language: "javascript",
        contentHash: "h1",
        lastIndexedAt: now
      },
      {
        id: "backend/controllers/authController.js",
        path: "backend/controllers/authController.js",
        language: "javascript",
        contentHash: "h2",
        lastIndexedAt: now
      },
      {
        id: "backend/middleware/authMiddleware.js",
        path: "backend/middleware/authMiddleware.js",
        language: "javascript",
        contentHash: "h3",
        lastIndexedAt: now
      },
      {
        id: "backend/routes/authRoutes.js",
        path: "backend/routes/authRoutes.js",
        language: "javascript",
        contentHash: "h4",
        lastIndexedAt: now
      },
      {
        id: "backend/tests/authController.test.js",
        path: "backend/tests/authController.test.js",
        language: "javascript",
        contentHash: "h5",
        lastIndexedAt: now
      },
      {
        id: "backend/tests/userModel.test.js",
        path: "backend/tests/userModel.test.js",
        language: "javascript",
        contentHash: "h6",
        lastIndexedAt: now
      }
    ],
    edges: [
      {
        sourceId: "backend/controllers/authController.js",
        targetId: "backend/models/User.js",
        relation: "imports",
        confidence: "confirmed"
      },
      {
        sourceId: "backend/middleware/authMiddleware.js",
        targetId: "backend/models/User.js",
        relation: "imports",
        confidence: "confirmed"
      },
      {
        sourceId: "backend/routes/authRoutes.js",
        targetId: "backend/controllers/authController.js",
        relation: "imports",
        confidence: "confirmed"
      },
      {
        sourceId: "backend/routes/authRoutes.js",
        targetId: "backend/middleware/authMiddleware.js",
        relation: "imports",
        confidence: "confirmed"
      },
      {
        sourceId: "backend/tests/authController.test.js",
        targetId: "backend/controllers/authController.js",
        relation: "imports",
        confidence: "confirmed"
      },
      {
        sourceId: "backend/tests/userModel.test.js",
        targetId: "backend/models/User.js",
        relation: "imports",
        confidence: "confirmed"
      }
    ]
  };
}

describe("Phase 8 — @codemind/ai-core Impact Intelligence", () => {
  it("8.2 & 8.3: computes direct and transitive dependents with multiple paths and cycle safety", () => {
    const graph = makeGraph();
    // Introduce a cycle: User.js -> authRoutes.js
    graph.edges.push({
      sourceId: "backend/models/User.js",
      targetId: "backend/routes/authRoutes.js",
      relation: "imports",
      confidence: "inferred"
    });

    const result = analyzeDependencyImpact({
      targetFiles: [{ filePath: "backend/models/User.js" }],
      graph,
      fileMetaByPath: new Map(),
      maxDepth: 3,
      maxAffectedFiles: 50
    });

    const directPaths = result.impactedFiles
      .filter((f) => f.category === "direct")
      .map((f) => f.filePath);
    const transitivePaths = result.impactedFiles
      .filter((f) => f.category === "transitive")
      .map((f) => f.filePath);

    expect(directPaths).toContain("backend/controllers/authController.js");
    expect(directPaths).toContain("backend/middleware/authMiddleware.js");
    expect(transitivePaths).toContain("backend/routes/authRoutes.js");

    const routesFile = result.impactedFiles.find(
      (f) => f.filePath === "backend/routes/authRoutes.js"
    );
    expect(routesFile?.pathsFromTarget.length).toBeGreaterThanOrEqual(2);
    expect(result.cyclesDetected).toBeGreaterThanOrEqual(1);
    expect(result.truncated).toBe(false);
  });

  it("8.3: respects maxAffectedFiles cap and marks truncated=true", () => {
    const graph = makeGraph();
    const result = analyzeDependencyImpact({
      targetFiles: [{ filePath: "backend/models/User.js" }],
      graph,
      fileMetaByPath: new Map(),
      maxDepth: 3,
      maxAffectedFiles: 2
    });

    expect(result.impactedFiles.length).toBeLessThanOrEqual(2);
    expect(result.truncated).toBe(true);
  });

  it("8.4: detects API contracts and database schemas (Mongoose, Prisma, SQL) + diffs", () => {
    const apiResult = analyzeApiContractImpact({
      affectedBackendAndTargetFiles: new Set([
        "backend/models/User.js",
        "backend/routes/authRoutes.js"
      ]),
      apiRelationships: [
        {
          method: "POST",
          endpoint: "/api/auth/login",
          handlerFile: "backend/routes/authRoutes.js",
          handlerLine: 10,
          callerFile: "frontend/src/lib/api.js",
          callerLine: 22,
          confidence: "confirmed",
          explanation: "Matched POST /api/auth/login"
        }
      ]
    });

    expect(apiResult.apiContracts).toHaveLength(1);
    expect(apiResult.apiContracts[0]?.frontendConsumers[0]?.filePath).toBe(
      "frontend/src/lib/api.js"
    );

    const mongooseBefore = `
      const mongoose = require('mongoose');
      const userSchema = new mongoose.Schema({
        email: { type: String, required: true },
        role: { type: String, required: false }
      });
      module.exports = mongoose.model('User', userSchema);
    `;
    const mongooseAfter = `
      const mongoose = require('mongoose');
      const userSchema = new mongoose.Schema({
        email: { type: String, required: true },
        role: { type: Number, required: true },
        avatarUrl: { type: String, required: false }
      });
      module.exports = mongoose.model('User', userSchema);
    `;

    const beforeModel = extractDatabaseFieldsFromSource("backend/models/User.js", mongooseBefore);
    const afterModel = extractDatabaseFieldsFromSource("backend/models/User.js", mongooseAfter);
    expect(beforeModel?.technology).toBe("mongoose");
    expect(beforeModel?.fields.map((f) => f.name)).toContain("email");

    const diff = diffDatabaseFields(beforeModel!.fields, afterModel!.fields);
    expect(diff.detectedChanges).toContain("field_added");
    expect(diff.detectedChanges).toContain("field_type_changed");
    expect(diff.detectedChanges).toContain("requiredness_changed");

    const prismaSource = `
      model Account {
        id String @id
        email String
        nickname String?
      }
    `;
    const prismaModel = extractDatabaseFieldsFromSource("prisma/schema.prisma", prismaSource);
    expect(prismaModel?.technology).toBe("prisma");
    expect(prismaModel?.modelName).toBe("Account");
    expect(prismaModel?.fields.find((f) => f.name === "nickname")?.required).toBe(false);

    const sqlSource = `
      CREATE TABLE invoices (
        id UUID PRIMARY KEY NOT NULL,
        amount DECIMAL NOT NULL,
        memo TEXT
      );
    `;
    const sqlModel = extractDatabaseFieldsFromSource("db/migrations/001.sql", sqlSource);
    expect(sqlModel?.technology).toBe("sql");
    expect(sqlModel?.modelName).toBe("invoices");

    const dbContracts = analyzeDatabaseContractImpact({
      targets: [
        {
          filePath: "backend/models/User.js",
          beforeContent: mongooseBefore,
          afterContent: mongooseAfter
        }
      ],
      consumerFilesByTarget: new Map([
        ["backend/models/User.js", ["backend/controllers/authController.js"]]
      ])
    });
    expect(dbContracts).toHaveLength(1);
    expect(dbContracts[0]?.detectedChanges).toContain("field_type_changed");
  });

  it("8.5: classifies definitely_affected and likely_affected tests and handles zero-test honesty", () => {
    const graph = makeGraph();
    const dep = analyzeDependencyImpact({
      targetFiles: [{ filePath: "backend/models/User.js" }],
      graph,
      fileMetaByPath: new Map(),
      maxDepth: 3,
      maxAffectedFiles: 50
    });

    const testOut = analyzeTestImpact({
      targetFiles: ["backend/models/User.js"],
      impactedFiles: dep.impactedFiles,
      allIndexedFiles: graph.nodes.map((n) => n.path),
      graph
    });

    const userTest = testOut.impactedTests.find(
      (t) => t.testFile === "backend/tests/userModel.test.js"
    );
    const ctrlTest = testOut.impactedTests.find(
      (t) => t.testFile === "backend/tests/authController.test.js"
    );

    expect(userTest?.classification).toBe("definitely_affected");
    expect(ctrlTest?.classification).toBe("likely_affected");

    // Zero tests case -> honest limitation
    const noTests = analyzeTestImpact({
      targetFiles: ["src/untested.ts"],
      impactedFiles: [],
      allIndexedFiles: ["src/untested.ts"],
      graph: { generatedAt: new Date().toISOString(), nodes: [], edges: [] }
    });
    expect(noTests.impactedTests).toHaveLength(0);
    expect(noTests.limitations[0]).toContain("No directly related test was discovered");
  });

  it("8.6: detects directly referenced, stale, and possible_conflict decisions without mutating them", () => {
    const now = new Date().toISOString();
    const decision: EngineeringDecision = {
      id: "dec-1",
      schemaVersion: 1,
      workspaceId: "ws-1",
      title: "Use Mongoose User schema with string role field",
      summary: "Keep User.role as string enum",
      context: "Standardize User schema",
      problem: "Role mismatch across auth middleware",
      decision: "Keep role as string enum",
      rationale: "Avoid breaking auth middleware",
      status: "accepted",
      category: "database",
      createdAt: now,
      updatedAt: now,
      decidedAt: now,
      createdBy: "developer",
      source: "manual",
      confidence: "developer_stated",
      tags: ["auth", "user"],
      alternatives: [],
      evidence: [
        {
          id: "e1",
          type: "source_file",
          filePath: "backend/models/User.js",
          description: "User Mongoose schema",
          verificationStatus: "current",
          provenance: "verified_evidence",
          timestamp: now,
          staleReason: null,
          isHistorical: false
        }
      ],
      tradeoffs: [],
      relatedDecisionIds: [],
      supersededById: null,
      relatedIntentId: null,
      gitReferences: [],
      verificationStatus: "current",
      history: []
    };

    const out = analyzeDecisionImpact({
      decisions: [decision],
      targetFiles: ["backend/models/User.js"],
      impactedFiles: [],
      changeType: "database_contract_changed"
    });

    expect(out.relatedDecisions).toHaveLength(1);
    expect(out.relatedDecisions[0]?.relation).toBe("possible_conflict");
    expect(out.relatedDecisions[0]?.explanation).toContain("review recommended");
    // Original decision object must remain completely untouched
    expect(decision.verificationStatus).toBe("current");
  });

  it("8.7, 8.8 & 8.9: computes deterministic explainable risk, impact graph, and real-command validation plan", () => {
    expect(scoreToRiskLevel(10)).toBe("low");
    expect(scoreToRiskLevel(35)).toBe("medium");
    expect(scoreToRiskLevel(60)).toBe("high");
    expect(scoreToRiskLevel(80)).toBe("critical");

    const risk = calculateImpactRisk({
      targetFiles: ["backend/models/User.js"],
      changeType: "database_contract_changed",
      impactedFiles: [
        {
          filePath: "backend/middleware/authMiddleware.js",
          language: "javascript",
          role: "middleware",
          category: "direct",
          depth: 1,
          referencedSymbols: [],
          pathsFromTarget: [["backend/models/User.js", "backend/middleware/authMiddleware.js"]],
          evidenceIds: [],
          explanation: "Direct"
        }
      ],
      apiContracts: [
        {
          id: "api-1",
          method: "POST",
          endpoint: "/api/auth/login",
          routeFile: "backend/routes/authRoutes.js",
          controllerFiles: [],
          frontendConsumers: [{ filePath: "frontend/src/lib/api.js", confidence: "confirmed" }],
          changeKind: "response_shape_changed",
          contractVerified: false,
          completeness: "partial",
          explanation: "API"
        }
      ],
      databaseContracts: [
        {
          id: "db-1",
          modelName: "User",
          technology: "mongoose",
          schemaFile: "backend/models/User.js",
          fields: [],
          consumerFiles: ["backend/middleware/authMiddleware.js"],
          detectedChanges: ["field_type_changed"],
          changeDetails: [],
          verified: false,
          explanation: "DB"
        }
      ],
      impactedTests: [],
      relatedDecisions: [
        {
          decisionId: "dec-1",
          title: "Keep role as string",
          category: "database",
          status: "accepted",
          verificationStatus: "verified",
          provenance: "developer_stated",
          relation: "possible_conflict",
          matchedFiles: ["backend/models/User.js"],
          explanation: "Possible conflict"
        }
      ],
      completeness: "partial",
      coverage: {
        totalIndexedFiles: 10,
        traversedNodes: 5,
        maxDepthConfigured: 3,
        maxDepthReached: 2,
        truncated: false,
        unresolvedImportCount: 1,
        cyclesDetected: 0,
        durationMs: 12
      }
    });

    expect(risk.calculationVersion).toBe("impact-risk-v1.0.0");
    expect(risk.score).toBeGreaterThanOrEqual(50);
    expect(["high", "critical"]).toContain(risk.level);
    expect(risk.factors).toHaveLength(7);
    expect(risk.uncertaintyNotes.length).toBeGreaterThan(0);

    const graphBuilt = buildImpactGraph({
      targetFiles: ["backend/models/User.js"],
      impactedFiles: [
        {
          filePath: "backend/middleware/authMiddleware.js",
          language: "javascript",
          role: "middleware",
          category: "direct",
          depth: 1,
          referencedSymbols: [],
          pathsFromTarget: [],
          evidenceIds: [],
          explanation: "Direct"
        }
      ],
      apiContracts: [],
      databaseContracts: [],
      impactedTests: [],
      relatedDecisions: [],
      relationships: []
    });
    expect(graphBuilt.nodes.some((n) => n.kind === "target_file")).toBe(true);
    expect(graphBuilt.nodes.some((n) => n.kind === "direct_dependent")).toBe(true);

    const plan = buildValidationPlan({
      targetFiles: ["backend/models/User.js"],
      impactedFiles: [],
      apiContracts: [],
      databaseContracts: [],
      impactedTests: [],
      relatedDecisions: [],
      discoveredCommands: [
        { id: "cmd-test", label: "Test", command: "pnpm test", category: "test" },
        { id: "cmd-tc", label: "Typecheck", command: "pnpm typecheck", category: "typecheck" }
      ]
    });

    expect(plan.length).toBeGreaterThanOrEqual(2);
    expect(plan.every((s) => s.requiresUserApproval === true)).toBe(true);
    expect(plan.every((s) => s.executionStatus === "pending")).toBe(true);
    // Should NOT invent a build or lint command when not discovered
    expect(plan.some((s) => s.category === "build")).toBe(false);
    expect(plan.some((s) => s.category === "lint")).toBe(false);
  });

  it("Review 2: deduplicates repeated dependencies/contracts, checks exact thresholds, and never reports incomplete analysis as low risk", () => {
    expect(scoreToRiskLevel(0)).toBe("low");
    expect(scoreToRiskLevel(24)).toBe("low");
    expect(scoreToRiskLevel(25)).toBe("medium");
    expect(scoreToRiskLevel(49)).toBe("medium");
    expect(scoreToRiskLevel(50)).toBe("high");
    expect(scoreToRiskLevel(74)).toBe("high");
    expect(scoreToRiskLevel(75)).toBe("critical");
    expect(scoreToRiskLevel(100)).toBe("critical");

    const singleImpacted = {
      filePath: "src/service.ts",
      language: "typescript",
      role: "service",
      category: "direct" as const,
      depth: 1,
      referencedSymbols: [],
      pathsFromTarget: [],
      evidenceIds: [],
      explanation: "Direct"
    };
    const singleApi = {
      id: "api-1",
      method: "GET",
      endpoint: "/api/items",
      routeFile: "src/routes.ts",
      controllerFiles: [],
      frontendConsumers: [{ filePath: "web/app.tsx", confidence: "confirmed" as const }],
      changeKind: "unknown_contract_change" as const,
      contractVerified: false,
      completeness: "partial" as const,
      explanation: "Route"
    };
    const baseInput = {
      targetFiles: ["src/core.ts"],
      changeType: "file_modified" as const,
      impactedFiles: [singleImpacted],
      apiContracts: [singleApi],
      databaseContracts: [],
      impactedTests: [],
      relatedDecisions: [],
      completeness: "complete" as const,
      coverage: {
        totalIndexedFiles: 10,
        traversedNodes: 2,
        maxDepthConfigured: 3,
        maxDepthReached: 1,
        truncated: false,
        unresolvedImportCount: 0,
        cyclesDetected: 0,
        durationMs: 5
      }
    };

    const r1 = calculateImpactRisk(baseInput);
    const r2 = calculateImpactRisk({
      ...baseInput,
      impactedFiles: [singleImpacted, singleImpacted, singleImpacted],
      apiContracts: [singleApi, { ...singleApi, id: "api-dup" }]
    });
    expect(r2.score).toBe(r1.score);
    expect(r2.level).toBe(r1.level);

    // Incomplete analysis with minimal factor score must NOT silently certify "low" risk
    const incompleteRisk = calculateImpactRisk({
      ...baseInput,
      impactedFiles: [],
      apiContracts: [],
      completeness: "incomplete"
    });
    expect(incompleteRisk.score).toBeLessThan(25);
    expect(incompleteRisk.level).toBe("medium");
    expect(incompleteRisk.explanation).toContain("incomplete analysis");
  });

  it("Review 3 & 4: reports missing graph target nodes, preserves target->dependent edge direction, and detects field renames & deleted models", () => {
    const graph = makeGraph();
    const dep = analyzeDependencyImpact({
      targetFiles: [{ filePath: "backend/models/User.js" }, { filePath: "unindexed/missing.py" }],
      graph,
      fileMetaByPath: new Map(),
      maxDepth: 2,
      maxAffectedFiles: 50
    });
    expect(dep.missingTargetNodes).toEqual(["unindexed/missing.py"]);

    const built = buildImpactGraph({
      targetFiles: ["backend/models/User.js"],
      impactedFiles: dep.impactedFiles,
      apiContracts: [],
      databaseContracts: [],
      impactedTests: [],
      relatedDecisions: [],
      relationships: dep.relationships
    });
    // Edge must flow from target -> direct dependent (not reversed)
    const forwardEdge = built.edges.find(
      (e) =>
        e.source === "file:backend/models/User.js" &&
        e.target === "file:backend/controllers/authController.js"
    );
    expect(forwardEdge).toBeDefined();

    // Field rename detection + deleted DB model handling
    const renameDiff = diffDatabaseFields(
      [{ name: "userName", fieldType: "String", required: true }],
      [{ name: "username", fieldType: "String", required: true }]
    );
    expect(renameDiff.detectedChanges).toContain("field_renamed");

    const deletedDb = analyzeDatabaseContractImpact({
      targets: [
        {
          filePath: "backend/models/Legacy.js",
          beforeContent: `const mongoose = require('mongoose');
const legacySchema = new mongoose.Schema({ code: { type: String, required: true } });
module.exports = mongoose.model('Legacy', legacySchema);`
        }
      ],
      consumerFilesByTarget: new Map([["backend/models/Legacy.js", ["backend/service.js"]]])
    });
    expect(deletedDb).toHaveLength(1);
    expect(deletedDb[0]?.modelName).toBe("Legacy");
    expect(deletedDb[0]?.detectedChanges).toContain("field_removed");
    expect(deletedDb[0]?.verified).toBe(true);
  });
});
