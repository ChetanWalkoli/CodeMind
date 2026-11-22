import { z } from "zod";

// ============================================================================
// Milestone 6.1 — Intent Understanding
// ============================================================================

export const IntentTypeSchema = z.enum([
  "bug_fix",
  "feature",
  "refactor",
  "optimization",
  "security",
  "performance",
  "code_explanation",
  "architecture_change",
  "testing",
  "documentation",
  "unknown"
]);
export type IntentType = z.infer<typeof IntentTypeSchema>;

export const IntentStatusSchema = z.enum([
  "draft",
  "parsing",
  "clarification_required",
  "ready_for_investigation",
  "investigating",
  "analyzing",
  "awaiting_review",
  "approved",
  "completed",
  "failed",
  "cancelled"
]);
export type IntentStatus = z.infer<typeof IntentStatusSchema>;

export const IntentCriterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  source: z.enum(["user", "inferred"]),
  confirmed: z.boolean().default(false)
});
export type IntentCriterion = z.infer<typeof IntentCriterionSchema>;

export const IntentClarificationQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  reason: z.string().min(1),
  suggestedOptions: z.array(z.string().min(1)).default([]),
  answer: z.string().nullable().default(null)
});
export type IntentClarificationQuestion = z.infer<typeof IntentClarificationQuestionSchema>;

export const IntentAmbiguitySchema = z.object({
  isAmbiguous: z.boolean(),
  reasons: z.array(z.string()).default([]),
  missingInformation: z.array(z.string()).default([])
});
export type IntentAmbiguity = z.infer<typeof IntentAmbiguitySchema>;

export const IntentRequestSchema = z.object({
  intentId: z.string().min(1),
  workspaceId: z.string().min(1),
  originalPrompt: z.string().min(1),
  normalizedGoal: z.string().min(1),
  intentType: IntentTypeSchema,
  constraints: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(IntentCriterionSchema).default([]),
  affectedAreas: z.array(z.string()).default([]),
  relevantFiles: z.array(z.string()).default([]),
  userPreferences: z.record(z.string(), z.string()).default({}),
  ambiguity: IntentAmbiguitySchema,
  clarificationQuestions: z.array(IntentClarificationQuestionSchema).default([]),
  confidence: z.enum(["high", "medium", "low"]),
  status: IntentStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type IntentRequest = z.infer<typeof IntentRequestSchema>;

// ============================================================================
// Milestone 6.2 — Codebase Investigation
// ============================================================================

export const InvestigationProgressStageSchema = z.enum([
  "understanding_request",
  "discovering_files",
  "exploring_dependencies",
  "tracing_api_relationships",
  "collecting_evidence",
  "preparing_report"
]);
export type InvestigationProgressStage = z.infer<typeof InvestigationProgressStageSchema>;

export const InvestigationRelationshipTypeSchema = z.enum([
  "import_dependency",
  "reverse_dependent",
  "function_call",
  "route_to_controller",
  "api_endpoint",
  "model_usage",
  "test_coverage"
]);
export type InvestigationRelationshipType = z.infer<typeof InvestigationRelationshipTypeSchema>;

export const InvestigationEvidenceRefSchema = z.object({
  evidenceId: z.string().min(1),
  filePath: z.string().min(1),
  contentHash: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbolName: z.string().optional(),
  snippet: z.string(),
  reason: z.string().min(1)
});
export type InvestigationEvidenceRef = z.infer<typeof InvestigationEvidenceRefSchema>;

export const InvestigationRelationSchema = z.object({
  sourceFile: z.string().min(1),
  targetFile: z.string().min(1),
  type: InvestigationRelationshipTypeSchema,
  evidence: z.string().min(1),
  confidence: z.enum(["confirmed", "inferred"])
});
export type InvestigationRelation = z.infer<typeof InvestigationRelationSchema>;

export const InvestigationFileRecordSchema = z.object({
  filePath: z.string().min(1),
  language: z.string().min(1),
  role: z.string().min(1),
  contentHash: z.string().min(1),
  lineCount: z.number().int().nonnegative(),
  relevanceScore: z.number(),
  reasons: z.array(z.string()).default([])
});
export type InvestigationFileRecord = z.infer<typeof InvestigationFileRecordSchema>;

export const InvestigationSymbolRecordSchema = z.object({
  filePath: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  exported: z.boolean()
});
export type InvestigationSymbolRecord = z.infer<typeof InvestigationSymbolRecordSchema>;

export const InvestigationApiLinkSchema = z.object({
  method: z.string().min(1),
  endpoint: z.string().min(1),
  callerFile: z.string().min(1),
  callerLine: z.number().int().positive(),
  handlerFile: z.string().min(1),
  handlerLine: z.number().int().positive(),
  confidence: z.enum(["confirmed", "inferred"]),
  explanation: z.string().min(1)
});
export type InvestigationApiLink = z.infer<typeof InvestigationApiLinkSchema>;

export const InvestigationLimitsSchema = z.object({
  maxFiles: z.number().int().positive().max(60).default(20),
  maxGraphDepth: z.number().int().positive().max(4).default(2),
  maxSymbols: z.number().int().positive().max(200).default(80),
  maxEvidenceRecords: z.number().int().positive().max(200).default(60),
  maxContextBytes: z
    .number()
    .int()
    .positive()
    .max(262_144)
    .default(128 * 1024)
});
export type InvestigationLimits = z.infer<typeof InvestigationLimitsSchema>;

export const InvestigationReportSchema = z.object({
  investigationId: z.string().min(1),
  intentId: z.string().min(1),
  workspaceId: z.string().min(1),
  relevantFiles: z.array(InvestigationFileRecordSchema),
  relevantSymbols: z.array(InvestigationSymbolRecordSchema),
  dependencyRelationships: z.array(InvestigationRelationSchema),
  apiRelationships: z.array(InvestigationApiLinkSchema),
  testFiles: z.array(z.string()),
  configAndSchemaFiles: z.array(z.string()),
  evidenceReferences: z.array(InvestigationEvidenceRefSchema),
  missingContext: z.array(z.string()),
  limitations: z.array(z.string()),
  limitsApplied: InvestigationLimitsSchema,
  durationMs: z.number().nonnegative(),
  totalBytesInspected: z.number().int().nonnegative(),
  reproducibleHash: z.string().min(1),
  createdAt: z.string().datetime()
});
export type InvestigationReport = z.infer<typeof InvestigationReportSchema>;

// ============================================================================
// Milestone 6.3 — Evidence-Based Analysis
// ============================================================================

export const EvidenceVerificationStatusSchema = z.enum([
  "verified",
  "inferred",
  "unknown",
  "contradicted"
]);
export type EvidenceVerificationStatus = z.infer<typeof EvidenceVerificationStatusSchema>;

export const IntentFindingCategorySchema = z.enum([
  "root_cause",
  "bug",
  "security",
  "performance",
  "architecture",
  "maintainability",
  "testing_gap",
  "contract_mismatch",
  "observation"
]);
export type IntentFindingCategory = z.infer<typeof IntentFindingCategorySchema>;

export const IntentFindingSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type IntentFindingSeverity = z.infer<typeof IntentFindingSeveritySchema>;

export const AnalysisFindingSchema = z.object({
  findingId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: IntentFindingCategorySchema,
  severity: IntentFindingSeveritySchema,
  confidence: z.enum(["high", "medium", "low"]),
  evidenceReferences: z.array(InvestigationEvidenceRefSchema),
  affectedFiles: z.array(z.string().min(1)),
  reasoning: z.string().min(1),
  verificationStatus: EvidenceVerificationStatusSchema
});
export type AnalysisFinding = z.infer<typeof AnalysisFindingSchema>;

export const AnalysisContradictionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  filesInvolved: z.array(z.string().min(1)),
  evidenceReferences: z.array(InvestigationEvidenceRefSchema)
});
export type AnalysisContradiction = z.infer<typeof AnalysisContradictionSchema>;

export const AnalysisReportSchema = z.object({
  analysisId: z.string().min(1),
  intentId: z.string().min(1),
  investigationId: z.string().min(1),
  summary: z.string().min(1),
  findings: z.array(AnalysisFindingSchema),
  verifiedFacts: z.array(z.string()),
  hypotheses: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  contradictions: z.array(AnalysisContradictionSchema),
  riskObservations: z.array(z.string()),
  usedAiReasoning: z.boolean(),
  createdAt: z.string().datetime()
});
export type AnalysisReport = z.infer<typeof AnalysisReportSchema>;

// ============================================================================
// Milestone 6.4 — Recommendation Engine
// ============================================================================

export const RecommendationCategorySchema = z.enum([
  "correctness",
  "security",
  "performance",
  "maintainability",
  "architecture",
  "reliability",
  "testing",
  "developer_experience"
]);
export type RecommendationCategory = z.infer<typeof RecommendationCategorySchema>;

export const RecommendationDecisionSchema = z.enum([
  "pending",
  "selected",
  "rejected",
  "deferred",
  "approved_for_patch"
]);
export type RecommendationDecision = z.infer<typeof RecommendationDecisionSchema>;

export const EngineeringRecommendationSchema = z.object({
  recommendationId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  rationale: z.string().min(1),
  category: RecommendationCategorySchema,
  linkedFindingIds: z.array(z.string().min(1)),
  affectedFiles: z.array(z.string().min(1)),
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  severity: IntentFindingSeveritySchema,
  expectedBenefit: z.string().min(1),
  implementationComplexity: z.enum(["low", "medium", "high"]),
  estimatedRisk: z.enum(["low", "medium", "high"]),
  dependencies: z.array(z.string()).default([]),
  proposedSteps: z.array(z.string().min(1)),
  validationStrategy: z.string().min(1),
  rankScore: z.number(),
  rankingFactors: z.array(z.string()),
  decision: RecommendationDecisionSchema.default("pending"),
  decisionNote: z.string().nullable().default(null)
});
export type EngineeringRecommendation = z.infer<typeof EngineeringRecommendationSchema>;

// ============================================================================
// Milestones 6.5 & 6.6 — Patch Generation & Diff Review
// ============================================================================

export const PatchReviewDecisionSchema = z.enum(["pending", "accepted", "rejected", "invalid"]);
export type PatchReviewDecision = z.infer<typeof PatchReviewDecisionSchema>;

export const PatchLineRangeSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive()
});
export type PatchLineRange = z.infer<typeof PatchLineRangeSchema>;

export const PatchValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  stale: z.boolean().default(false)
});
export type PatchValidationResult = z.infer<typeof PatchValidationResultSchema>;

export const IntentPatchProposalSchema = z.object({
  patchId: z.string().min(1),
  intentId: z.string().min(1),
  recommendationIds: z.array(z.string().min(1)),
  targetFile: z.string().min(1),
  language: z.string().min(1),
  originalFileHash: z.string().min(1),
  proposedFileHash: z.string().min(1),
  originalContentVersion: z.number().int().positive().default(1),
  originalContent: z.string(),
  proposedContent: z.string(),
  unifiedDiff: z.string(),
  changedLineRanges: z.array(PatchLineRangeSchema),
  addedLines: z.number().int().nonnegative(),
  removedLines: z.number().int().nonnegative(),
  patchSummary: z.string().min(1),
  validation: PatchValidationResultSchema,
  reviewDecision: PatchReviewDecisionSchema.default("pending"),
  generatedAt: z.string().datetime()
});
export type IntentPatchProposal = z.infer<typeof IntentPatchProposalSchema>;

// ============================================================================
// Milestone 6.7 — Approval & Safe Patch Application
// ============================================================================

export const PatchApprovalEntrySchema = z.object({
  patchId: z.string().min(1),
  targetFile: z.string().min(1),
  originalFileHash: z.string().min(1),
  proposedFileHash: z.string().min(1),
  originalContentVersion: z.number().int().positive()
});
export type PatchApprovalEntry = z.infer<typeof PatchApprovalEntrySchema>;

export const PatchApprovalRecordSchema = z.object({
  approvalId: z.string().min(1),
  intentId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  entries: z.array(PatchApprovalEntrySchema).min(1),
  approved: z.boolean(),
  approvedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});
export type PatchApprovalRecord = z.infer<typeof PatchApprovalRecordSchema>;

export const PatchTransactionStatusSchema = z.enum([
  "pending",
  "applied",
  "failed",
  "recovered",
  "needs_recovery",
  "rolled_back"
]);
export type PatchTransactionStatus = z.infer<typeof PatchTransactionStatusSchema>;

export const PatchFileSnapshotMetaSchema = z.object({
  targetFile: z.string().min(1),
  originalFileHash: z.string().min(1),
  appliedFileHash: z.string().min(1),
  snapshotFileName: z.string().min(1),
  snapshotHash: z.string().min(1),
  fileMode: z.number().int().optional()
});
export type PatchFileSnapshotMeta = z.infer<typeof PatchFileSnapshotMetaSchema>;

export const PatchTransactionFileResultSchema = z.object({
  patchId: z.string().min(1),
  targetFile: z.string().min(1),
  status: z.enum(["applied", "failed", "recovered", "skipped"]),
  addedLines: z.number().int().nonnegative(),
  removedLines: z.number().int().nonnegative(),
  originalFileHash: z.string().min(1),
  appliedFileHash: z.string().nullable(),
  error: z.string().nullable()
});
export type PatchTransactionFileResult = z.infer<typeof PatchTransactionFileResultSchema>;

export const PatchTransactionRecordSchema = z.object({
  transactionId: z.string().min(1),
  intentId: z.string().min(1),
  approvalId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  status: PatchTransactionStatusSchema,
  files: z.array(PatchTransactionFileResultSchema),
  snapshots: z.array(PatchFileSnapshotMetaSchema),
  errorSummary: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable()
});
export type PatchTransactionRecord = z.infer<typeof PatchTransactionRecordSchema>;

// ============================================================================
// Milestone 6.8 — Verification Engine
// ============================================================================

export const VerificationCommandKindSchema = z.enum([
  "test",
  "typecheck",
  "lint",
  "format",
  "build",
  "custom"
]);
export type VerificationCommandKind = z.infer<typeof VerificationCommandKindSchema>;

export const VerificationCandidateCommandSchema = z.object({
  commandId: z.string().min(1),
  label: z.string().min(1),
  kind: VerificationCommandKindSchema,
  executable: z.string().min(1),
  args: z.array(z.string()),
  displayCommand: z.string().min(1),
  scriptSource: z.string().min(1),
  workingDirectory: z.string().min(1),
  safe: z.boolean(),
  blockedReason: z.string().nullable()
});
export type VerificationCandidateCommand = z.infer<typeof VerificationCandidateCommandSchema>;

export const VerificationRunStatusSchema = z.enum([
  "passed",
  "failed",
  "timed_out",
  "cancelled",
  "blocked"
]);
export type VerificationRunStatus = z.infer<typeof VerificationRunStatusSchema>;

export const VerificationRunRecordSchema = z.object({
  verificationId: z.string().min(1),
  intentId: z.string().min(1),
  transactionId: z.string().nullable(),
  commandId: z.string().min(1),
  displayCommand: z.string().min(1),
  kind: VerificationCommandKindSchema,
  approvedByUser: z.boolean(),
  approvedAt: z.string().datetime(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().int().nullable(),
  status: VerificationRunStatusSchema,
  stdout: z.string(),
  stderr: z.string(),
  outputTruncated: z.boolean(),
  timedOut: z.boolean(),
  passedCount: z.number().int().nonnegative().nullable(),
  failedCount: z.number().int().nonnegative().nullable(),
  errorSummary: z.string().nullable()
});
export type VerificationRunRecord = z.infer<typeof VerificationRunRecordSchema>;

// ============================================================================
// Milestone 6.9 — Rollback & Recovery
// ============================================================================

export const RollbackModeSchema = z.enum(["single-file", "full-transaction", "partial-recovery"]);
export type RollbackMode = z.infer<typeof RollbackModeSchema>;

export const RollbackConflictSchema = z.object({
  targetFile: z.string().min(1),
  reason: z.enum(["modified_after_patch", "missing_backup", "corrupted_backup", "file_deleted"]),
  message: z.string().min(1),
  expectedAppliedHash: z.string(),
  currentDiskHash: z.string().nullable()
});
export type RollbackConflict = z.infer<typeof RollbackConflictSchema>;

export const RollbackCheckResultSchema = z.object({
  transactionId: z.string().min(1),
  canRollbackCleanly: z.boolean(),
  conflicts: z.array(RollbackConflictSchema),
  eligibleFiles: z.array(z.string())
});
export type RollbackCheckResult = z.infer<typeof RollbackCheckResultSchema>;

export const RollbackFileOutcomeSchema = z.object({
  targetFile: z.string().min(1),
  status: z.enum(["restored", "already_original", "skipped_conflict", "failed"]),
  message: z.string().min(1)
});
export type RollbackFileOutcome = z.infer<typeof RollbackFileOutcomeSchema>;

export const RollbackRecordSchema = z.object({
  rollbackId: z.string().min(1),
  intentId: z.string().min(1),
  transactionId: z.string().min(1),
  mode: RollbackModeSchema,
  forcedOverwrite: z.boolean(),
  status: z.enum(["completed", "partial", "failed"]),
  files: z.array(RollbackFileOutcomeSchema),
  createdAt: z.string().datetime()
});
export type RollbackRecord = z.infer<typeof RollbackRecordSchema>;

// ============================================================================
// Complete Intent Session Container
// ============================================================================

export const IntentAuditEventSchema = z.object({
  id: z.string().min(1),
  stage: z.string().min(1),
  action: z.string().min(1),
  summary: z.string().min(1),
  timestamp: z.string().datetime()
});
export type IntentAuditEvent = z.infer<typeof IntentAuditEventSchema>;

export const IntentSessionSchema = z.object({
  intent: IntentRequestSchema,
  investigation: InvestigationReportSchema.nullable().default(null),
  analysis: AnalysisReportSchema.nullable().default(null),
  recommendations: z.array(EngineeringRecommendationSchema).default([]),
  patches: z.array(IntentPatchProposalSchema).default([]),
  approvals: z.array(PatchApprovalRecordSchema).default([]),
  transactions: z.array(PatchTransactionRecordSchema).default([]),
  verifications: z.array(VerificationRunRecordSchema).default([]),
  rollbacks: z.array(RollbackRecordSchema).default([]),
  auditEvents: z.array(IntentAuditEventSchema).default([])
});
export type IntentSession = z.infer<typeof IntentSessionSchema>;

export const IntentSessionSummarySchema = z.object({
  intentId: z.string().min(1),
  workspaceId: z.string().min(1),
  normalizedGoal: z.string().min(1),
  intentType: IntentTypeSchema,
  status: IntentStatusSchema,
  confidence: z.enum(["high", "medium", "low"]),
  patchCount: z.number().int().nonnegative(),
  transactionCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type IntentSessionSummary = z.infer<typeof IntentSessionSummarySchema>;
