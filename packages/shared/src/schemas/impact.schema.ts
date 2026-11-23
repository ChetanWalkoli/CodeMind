import { z } from "zod";
import { RelationshipConfidenceSchema } from "./code-engine.schema.js";

// ============================================================================
// Phase 0 Legacy ImpactReport (preserved for backward compatibility)
// ============================================================================

export const ImpactLevelSchema = z.enum([
  "direct-dependency",
  "indirect-dependency",
  "api-contract",
  "related-test",
  "historical-decision"
]);

export type ImpactLevel = z.infer<typeof ImpactLevelSchema>;

export const ImpactItemSchema = z.object({
  filePath: z.string().min(1),
  symbol: z.string().optional(),
  level: ImpactLevelSchema,
  confidence: RelationshipConfidenceSchema,
  reason: z.string().min(1)
});

export type ImpactItem = z.infer<typeof ImpactItemSchema>;

export const ImpactReportSchema = z.object({
  targetPath: z.string().min(1),
  targetSymbol: z.string().optional(),
  items: z.array(ImpactItemSchema),
  generatedAt: z.string().datetime()
});

export type ImpactReport = z.infer<typeof ImpactReportSchema>;

// ============================================================================
// Phase 8 — Change Impact Intelligence Versioned Schemas (Milestones 8.1–8.9)
// ============================================================================

export const IMPACT_SCHEMA_VERSION = 1 as const;
export const IMPACT_RISK_MODEL_VERSION = "impact-risk-v1.0.0" as const;

export const ImpactChangeTypeSchema = z.enum([
  "file_modified",
  "file_created",
  "file_deleted",
  "symbol_modified",
  "symbol_removed",
  "symbol_added",
  "api_contract_changed",
  "database_contract_changed",
  "unknown"
]);
export type ImpactChangeType = z.infer<typeof ImpactChangeTypeSchema>;

export const ImpactAnalysisStatusSchema = z.enum([
  "pending",
  "analyzing",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "stale"
]);
export type ImpactAnalysisStatus = z.infer<typeof ImpactAnalysisStatusSchema>;

export const ImpactCompletenessSchema = z.enum(["complete", "partial", "incomplete"]);
export type ImpactCompleteness = z.infer<typeof ImpactCompletenessSchema>;

export const ImpactCategorySchema = z.enum(["direct", "transitive", "potential", "unknown"]);
export type ImpactCategory = z.infer<typeof ImpactCategorySchema>;

export const ImpactProvenanceSchema = z.enum([
  "confirmed_static",
  "inferred_contract",
  "decision_memory",
  "heuristic",
  "unknown"
]);
export type ImpactProvenance = z.infer<typeof ImpactProvenanceSchema>;

export const ImpactRelationshipTypeSchema = z.enum([
  "imports",
  "exports",
  "calls",
  "references",
  "uses_model",
  "uses_api",
  "implements_route",
  "consumes_api",
  "tests",
  "depends_on",
  "decision_references",
  "possible_dependency"
]);
export type ImpactRelationshipType = z.infer<typeof ImpactRelationshipTypeSchema>;

export const ImpactEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  filePath: z.string().min(1).max(400),
  symbolName: z.string().max(200).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  sourceHash: z.string().max(128).optional(),
  evidenceType: z.enum([
    "import_edge",
    "symbol_reference",
    "api_relationship",
    "database_model",
    "test_import",
    "decision_evidence",
    "git_diff"
  ]),
  provenance: ImpactProvenanceSchema,
  verificationStatus: z.enum(["current", "stale", "unverified"]).default("current"),
  explanation: z.string().min(1).max(600)
});
export type ImpactEvidence = z.infer<typeof ImpactEvidenceSchema>;

export const ImpactRelationshipSchema = z.object({
  id: z.string().min(1),
  sourceNode: z.string().min(1).max(400),
  destinationNode: z.string().min(1).max(400),
  relationshipType: ImpactRelationshipTypeSchema,
  depth: z.number().int().nonnegative().max(10),
  evidenceId: z.string().min(1).optional(),
  provenance: ImpactProvenanceSchema,
  confidence: z.enum(["confirmed", "inferred", "unknown"]),
  explanation: z.string().min(1).max(500)
});
export type ImpactRelationship = z.infer<typeof ImpactRelationshipSchema>;

export const ImpactedFileSchema = z.object({
  filePath: z.string().min(1).max(400),
  language: z.string().max(60).default("text"),
  role: z.string().max(80).default("general"),
  category: ImpactCategorySchema,
  depth: z.number().int().nonnegative().max(10),
  sourceHash: z.string().max(128).optional(),
  referencedSymbols: z.array(z.string().max(200)).max(50).default([]),
  pathsFromTarget: z
    .array(z.array(z.string().max(400)).max(12))
    .max(10)
    .default([]),
  evidenceIds: z.array(z.string().min(1)).max(30).default([]),
  explanation: z.string().min(1).max(600)
});
export type ImpactedFile = z.infer<typeof ImpactedFileSchema>;

export const ImpactedSymbolSchema = z.object({
  filePath: z.string().min(1).max(400),
  symbolName: z.string().min(1).max(200),
  kind: z.string().max(60),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  category: ImpactCategorySchema,
  usedByFiles: z.array(z.string().max(400)).max(50).default([])
});
export type ImpactedSymbol = z.infer<typeof ImpactedSymbolSchema>;

// ---- 8.4 API & Database Contract Impact ----

export const ContractChangeKindSchema = z.enum([
  "field_added",
  "field_removed",
  "field_renamed",
  "field_type_changed",
  "requiredness_changed",
  "response_shape_changed",
  "request_shape_changed",
  "route_changed",
  "method_changed",
  "relation_changed",
  "unknown_contract_change"
]);
export type ContractChangeKind = z.infer<typeof ContractChangeKindSchema>;

export const ImpactApiContractSchema = z.object({
  id: z.string().min(1),
  method: z.string().min(1).max(16),
  endpoint: z.string().min(1).max(300),
  routeFile: z.string().min(1).max(400),
  routeLine: z.number().int().positive().optional(),
  controllerFiles: z.array(z.string().max(400)).max(20).default([]),
  frontendConsumers: z.array(
    z.object({
      filePath: z.string().min(1).max(400),
      line: z.number().int().positive().optional(),
      confidence: z.enum(["confirmed", "inferred"])
    })
  ),
  changeKind: ContractChangeKindSchema.default("unknown_contract_change"),
  contractVerified: z.boolean().default(false),
  completeness: ImpactCompletenessSchema.default("partial"),
  explanation: z.string().min(1).max(600)
});
export type ImpactApiContract = z.infer<typeof ImpactApiContractSchema>;

export const DatabaseFieldSummarySchema = z.object({
  name: z.string().min(1).max(120),
  fieldType: z.string().max(120),
  required: z.boolean()
});
export type DatabaseFieldSummary = z.infer<typeof DatabaseFieldSummarySchema>;

export const ImpactDatabaseContractSchema = z.object({
  id: z.string().min(1),
  modelName: z.string().min(1).max(160),
  technology: z.enum(["mongoose", "prisma", "sql", "typescript_entity", "unknown"]),
  schemaFile: z.string().min(1).max(400),
  fields: z.array(DatabaseFieldSummarySchema).max(100).default([]),
  consumerFiles: z.array(z.string().max(400)).max(50).default([]),
  detectedChanges: z.array(ContractChangeKindSchema).default([]),
  changeDetails: z.array(z.string().max(300)).default([]),
  verified: z.boolean().default(false),
  explanation: z.string().min(1).max(600)
});
export type ImpactDatabaseContract = z.infer<typeof ImpactDatabaseContractSchema>;

// ---- 8.5 Test Impact Detection ----

export const ImpactTestClassificationSchema = z.enum([
  "definitely_affected",
  "likely_affected",
  "recommended_additional"
]);
export type ImpactTestClassification = z.infer<typeof ImpactTestClassificationSchema>;

export const ImpactTestItemSchema = z.object({
  id: z.string().min(1),
  testFile: z.string().min(1).max(400),
  suiteName: z.string().max(200).optional(),
  relatedSourceFile: z.string().min(1).max(400),
  dependencyPath: z.array(z.string().max(400)).max(12).default([]),
  classification: ImpactTestClassificationSchema,
  priority: z.enum(["critical", "high", "medium", "low"]),
  reason: z.string().min(1).max(500),
  evidenceIds: z.array(z.string().min(1)).max(20).default([])
});
export type ImpactTestItem = z.infer<typeof ImpactTestItemSchema>;

// ---- 8.6 Decision Memory Impact ----

export const DecisionImpactRelationSchema = z.enum([
  "directly_referenced",
  "transitively_related",
  "potentially_affected",
  "stale_evidence",
  "possible_conflict",
  "unrelated"
]);
export type DecisionImpactRelation = z.infer<typeof DecisionImpactRelationSchema>;

export const ImpactDecisionRefSchema = z.object({
  decisionId: z.string().min(1),
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(60),
  status: z.string().min(1).max(40),
  verificationStatus: z.string().min(1).max(40),
  provenance: z.string().min(1).max(40),
  relation: DecisionImpactRelationSchema,
  matchedFiles: z.array(z.string().max(400)).max(20).default([]),
  explanation: z.string().min(1).max(600)
});
export type ImpactDecisionRef = z.infer<typeof ImpactDecisionRefSchema>;

// ---- 8.7 Explainable Risk Scoring ----

export const ImpactRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type ImpactRiskLevel = z.infer<typeof ImpactRiskLevelSchema>;

export const ImpactRiskFactorSchema = z.object({
  factorId: z.string().min(1),
  label: z.string().min(1).max(160),
  contribution: z.number().min(0).max(100),
  maxContribution: z.number().positive().max(100),
  explanation: z.string().min(1).max(400),
  supportingEvidence: z.array(z.string().max(300)).max(20).default([])
});
export type ImpactRiskFactor = z.infer<typeof ImpactRiskFactorSchema>;

export const ImpactRiskSchema = z.object({
  score: z.number().min(0).max(100),
  level: ImpactRiskLevelSchema,
  calculationVersion: z.string().min(1),
  factors: z.array(ImpactRiskFactorSchema),
  explanation: z.string().min(1).max(800),
  uncertaintyNotes: z.array(z.string().max(300)).default([])
});
export type ImpactRisk = z.infer<typeof ImpactRiskSchema>;

// ---- 8.9 Validation Plan ----

export const ImpactValidationCategorySchema = z.enum([
  "unit_test",
  "integration_test",
  "api_validation",
  "database_validation",
  "frontend_validation",
  "build",
  "typecheck",
  "lint",
  "manual_review"
]);
export type ImpactValidationCategory = z.infer<typeof ImpactValidationCategorySchema>;

export const ImpactValidationStepStatusSchema = z.enum([
  "pending",
  "completed",
  "skipped",
  "blocked"
]);
export type ImpactValidationStepStatus = z.infer<typeof ImpactValidationStepStatusSchema>;

export const ImpactValidationStepSchema = z.object({
  stepId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(600),
  category: ImpactValidationCategorySchema,
  relatedFiles: z.array(z.string().max(400)).max(25).default([]),
  relatedTests: z.array(z.string().max(400)).max(25).default([]),
  recommendedCommand: z.string().max(200).nullable().default(null),
  commandId: z.string().max(100).nullable().default(null),
  priority: z.enum(["critical", "high", "medium", "low"]),
  reason: z.string().min(1).max(500),
  requiresUserApproval: z.boolean().default(true),
  executionStatus: ImpactValidationStepStatusSchema.default("pending")
});
export type ImpactValidationStep = z.infer<typeof ImpactValidationStepSchema>;

// ---- 8.8 Impact Graph Nodes & Edges ----

export const ImpactGraphNodeKindSchema = z.enum([
  "target_file",
  "direct_dependent",
  "transitive_dependent",
  "potential_dependent",
  "api_route",
  "frontend_consumer",
  "database_model",
  "test_file",
  "decision"
]);
export type ImpactGraphNodeKind = z.infer<typeof ImpactGraphNodeKindSchema>;

export const ImpactGraphNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
  filePath: z.string().max(400).optional(),
  kind: ImpactGraphNodeKindSchema,
  depth: z.number().int().nonnegative().max(10),
  category: ImpactCategorySchema,
  badge: z.string().max(80).optional()
});
export type ImpactGraphNode = z.infer<typeof ImpactGraphNodeSchema>;

export const ImpactGraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  relationshipType: ImpactRelationshipTypeSchema,
  confidence: z.enum(["confirmed", "inferred", "unknown"]),
  label: z.string().max(120)
});
export type ImpactGraphEdge = z.infer<typeof ImpactGraphEdgeSchema>;

// ---- 8.1 Main Request & Result Schemas ----

export const ImpactTargetInputSchema = z.object({
  filePath: z.string().trim().min(1).max(400),
  symbolName: z.string().trim().max(200).optional(),
  changedLineRanges: z
    .array(
      z.object({ startLine: z.number().int().positive(), endLine: z.number().int().positive() })
    )
    .max(50)
    .optional(),
  beforeContent: z.string().max(128_000).optional(),
  afterContent: z.string().max(128_000).optional(),
  beforeHash: z.string().max(128).optional(),
  afterHash: z.string().max(128).optional()
});
export type ImpactTargetInput = z.infer<typeof ImpactTargetInputSchema>;

export const ImpactAnalysisRequestSchema = z.object({
  requestId: z.string().trim().max(128).optional(),
  workspaceRoot: z.string().min(1),
  targets: z.array(ImpactTargetInputSchema).min(1).max(20),
  changeType: ImpactChangeTypeSchema.default("file_modified"),
  maxDepth: z.number().int().min(1).max(5).default(3),
  maxAffectedFiles: z.number().int().min(5).max(150).default(50),
  includeGitDiff: z.boolean().optional()
});
export type ImpactAnalysisRequest = z.infer<typeof ImpactAnalysisRequestSchema>;

export const ImpactCoverageSchema = z.object({
  totalIndexedFiles: z.number().int().nonnegative(),
  traversedNodes: z.number().int().nonnegative(),
  maxDepthConfigured: z.number().int().positive(),
  maxDepthReached: z.number().int().nonnegative(),
  truncated: z.boolean(),
  unresolvedImportCount: z.number().int().nonnegative(),
  cyclesDetected: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative()
});
export type ImpactCoverage = z.infer<typeof ImpactCoverageSchema>;

export const ImpactAnalysisResultSchema = z.object({
  analysisId: z.string().min(1),
  schemaVersion: z.literal(IMPACT_SCHEMA_VERSION).default(IMPACT_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  status: ImpactAnalysisStatusSchema,
  completeness: ImpactCompletenessSchema,
  completenessReason: z.string().min(1).max(400),
  changeType: ImpactChangeTypeSchema,
  analyzedTargets: z.array(
    z.object({
      filePath: z.string().min(1),
      symbolName: z.string().optional(),
      sourceHash: z.string().optional(),
      existsOnDisk: z.boolean()
    })
  ),
  impactedFiles: z.array(ImpactedFileSchema),
  impactedSymbols: z.array(ImpactedSymbolSchema),
  apiContracts: z.array(ImpactApiContractSchema),
  databaseContracts: z.array(ImpactDatabaseContractSchema),
  impactedTests: z.array(ImpactTestItemSchema),
  relatedDecisions: z.array(ImpactDecisionRefSchema),
  relationships: z.array(ImpactRelationshipSchema),
  evidence: z.array(ImpactEvidenceSchema),
  graphNodes: z.array(ImpactGraphNodeSchema),
  graphEdges: z.array(ImpactGraphEdgeSchema),
  risk: ImpactRiskSchema,
  validationPlan: z.array(ImpactValidationStepSchema),
  coverage: ImpactCoverageSchema,
  limitations: z.array(z.string().max(400)),
  staleFiles: z.array(z.string().max(400)).default([]),
  createdAt: z.string().datetime()
});
export type ImpactAnalysisResult = z.infer<typeof ImpactAnalysisResultSchema>;

export const ImpactAnalysisSummarySchema = z.object({
  analysisId: z.string().min(1),
  targetFiles: z.array(z.string()),
  changeType: ImpactChangeTypeSchema,
  status: ImpactAnalysisStatusSchema,
  riskLevel: ImpactRiskLevelSchema,
  riskScore: z.number().min(0).max(100),
  impactedFileCount: z.number().int().nonnegative(),
  impactedTestCount: z.number().int().nonnegative(),
  relatedDecisionCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime()
});
export type ImpactAnalysisSummary = z.infer<typeof ImpactAnalysisSummarySchema>;
