import { z } from "zod";

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const SourceReferenceSchema = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  symbol: z.string().min(1).optional()
});

export type SourceReference = z.infer<typeof SourceReferenceSchema>;

export const CodebaseAnswerSchema = z.object({
  summary: z.string().min(1),
  explanation: z.array(z.string().min(1)),
  references: z.array(SourceReferenceSchema),
  confidence: ConfidenceLevelSchema,
  limitations: z.array(z.string())
});

export type CodebaseAnswer = z.infer<typeof CodebaseAnswerSchema>;

export const FindingCategorySchema = z.enum([
  "performance",
  "maintainability",
  "architecture",
  "security",
  "reliability",
  "bundle-size",
  "api-efficiency",
  "code-duplication"
]);

export type FindingCategory = z.infer<typeof FindingCategorySchema>;

export const FindingSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

export const OptimizationFindingSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: FindingCategorySchema,
  severity: FindingSeveritySchema,
  confidence: ConfidenceLevelSchema,
  evidence: z.array(z.string().min(1)).min(1),
  recommendation: z.string().min(1)
});

export type OptimizationFinding = z.infer<typeof OptimizationFindingSchema>;

export const PatchProposalSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  expectedContentHash: z.string().min(1),
  originalCode: z.string(),
  proposedCode: z.string(),
  explanation: z.string().min(1),
  risks: z.array(z.string()),
  assumptions: z.array(z.string())
});

export type PatchProposal = z.infer<typeof PatchProposalSchema>;

export const AITaskTypeSchema = z.enum([
  "explain-codebase",
  "explain-file",
  "code-qa",
  "architecture-overview",
  "impact-analysis"
]);

export type AITaskType = z.infer<typeof AITaskTypeSchema>;

export const ContextInclusionReasonSchema = z.enum([
  "active-file",
  "selected-symbol",
  "explicit-file",
  "user-added",
  "symbol-match",
  "normalized-match",
  "fuzzy-match",
  "path-match",
  "dependency",
  "dependent",
  "api-relationship",
  "backend-implementation",
  "frontend-integration",
  "architecture-summary"
]);

export type ContextInclusionReason = z.infer<typeof ContextInclusionReasonSchema>;

export const ContextItemSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  language: z.string().min(1),
  contentHash: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbols: z.array(z.string()),
  reasons: z.array(ContextInclusionReasonSchema).min(1),
  relevanceScore: z.number(),
  byteLength: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  truncated: z.boolean(),
  content: z.string()
});

export type ContextItem = z.infer<typeof ContextItemSchema>;

export const ContextExclusionReasonSchema = z.enum([
  "secret-file",
  "inline-secret",
  "ignored-path",
  "user-excluded",
  "binary-or-unreadable",
  "budget-exceeded",
  "token-budget-exceeded",
  "outside-workspace"
]);

export type ContextExclusionReason = z.infer<typeof ContextExclusionReasonSchema>;

export const ContextExcludedItemSchema = z.object({
  filePath: z.string().min(1),
  reason: ContextExclusionReasonSchema
});

export type ContextExcludedItem = z.infer<typeof ContextExcludedItemSchema>;

export const AITokenBudgetSummarySchema = z.object({
  modelId: z.string().min(1),
  contextWindowTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  reservedOutputTokens: z.number().int().positive(),
  safetyMarginTokens: z.number().int().nonnegative(),
  maxInputTokens: z.number().int().positive(),
  systemTokens: z.number().int().nonnegative(),
  userQueryTokens: z.number().int().nonnegative(),
  historyTokens: z.number().int().nonnegative(),
  availableContextTokens: z.number().int().nonnegative(),
  usedContextTokens: z.number().int().nonnegative(),
  totalEstimatedInputTokens: z.number().int().nonnegative(),
  estimatorId: z.string().min(1),
  isExactEstimate: z.boolean()
});

export type AITokenBudgetSummary = z.infer<typeof AITokenBudgetSummarySchema>;

export const ContextCoverageMetricsSchema = z.object({
  totalCandidates: z.number().int().nonnegative(),
  selectedFiles: z.number().int().nonnegative(),
  includedFiles: z.number().int().nonnegative(),
  excludedFiles: z.number().int().nonnegative(),
  truncatedFiles: z.number().int().nonnegative(),
  perFileMaxBytes: z.number().int().positive(),
  queryIntent: z.enum(["implementation", "ui", "api", "debugging", "architecture", "neutral"])
});

export type ContextCoverageMetrics = z.infer<typeof ContextCoverageMetricsSchema>;

export const MissingSourceSuggestionSchema = z.object({
  filePath: z.string().min(1),
  reason: z.string().min(1).optional()
});

export type MissingSourceSuggestion = z.infer<typeof MissingSourceSuggestionSchema>;

export const ResolvedMissingFileStatusSchema = z.enum([
  "exact-match",
  "similar-match",
  "not-found",
  "excluded-security",
  "already-included",
  "unsupported"
]);

export type ResolvedMissingFileStatus = z.infer<typeof ResolvedMissingFileStatusSchema>;

export const ResolvedMissingFileSchema = z.object({
  requestedPath: z.string().min(1),
  resolvedPath: z.string().nullable(),
  status: ResolvedMissingFileStatusSchema,
  reason: z.string().min(1)
});

export type ResolvedMissingFile = z.infer<typeof ResolvedMissingFileSchema>;

export const ContextSearchCandidateSchema = z.object({
  filePath: z.string().min(1),
  language: z.string().min(1),
  role: z.string().min(1),
  matchReason: z.string().min(1),
  blockedReason: z.string().nullable()
});

export type ContextSearchCandidate = z.infer<typeof ContextSearchCandidateSchema>;

export const AIContextSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  taskType: AITaskTypeSchema,
  templateId: z.string().min(1),
  templateVersion: z.string().min(1),
  query: z.string().min(1),
  items: z.array(ContextItemSchema),
  excluded: z.array(ContextExcludedItemSchema),
  totalBytes: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  budgetBytes: z.number().int().positive(),
  budget: AITokenBudgetSummarySchema.optional(),
  coverage: ContextCoverageMetricsSchema.optional(),
  createdAt: z.string().datetime()
});

export type AIContextSnapshot = z.infer<typeof AIContextSnapshotSchema>;

export const AIContextApprovalRecordSchema = z.object({
  snapshotId: z.string().min(1),
  approved: z.boolean(),
  approvedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable()
});

export type AIContextApprovalRecord = z.infer<typeof AIContextApprovalRecordSchema>;

export const StructuredResponseKindSchema = z.enum([
  "codebase-answer",
  "file-explanation",
  "architecture-explanation",
  "optimization-findings",
  "patch-proposal",
  "impact-report"
]);

export type StructuredResponseKind = z.infer<typeof StructuredResponseKindSchema>;

export const StructuredExplanationResponseSchema = CodebaseAnswerSchema.extend({
  verifiedFacts: z.array(z.string().min(1)).default([]),
  interpretations: z.array(z.string().min(1)).default([]),
  recommendations: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  missingFiles: z.array(MissingSourceSuggestionSchema).default([])
});

export type StructuredExplanationResponse = z.infer<typeof StructuredExplanationResponseSchema>;

export const OptimizationFindingsResponseSchema = z.object({
  summary: z.string().min(1),
  findings: z.array(OptimizationFindingSchema),
  references: z.array(SourceReferenceSchema).default([]),
  limitations: z.array(z.string()).default([])
});

export type OptimizationFindingsResponse = z.infer<typeof OptimizationFindingsResponseSchema>;

export const PatchProposalResponseSchema = z.object({
  summary: z.string().min(1),
  proposal: PatchProposalSchema,
  references: z.array(SourceReferenceSchema).default([])
});

export type PatchProposalResponse = z.infer<typeof PatchProposalResponseSchema>;

export const ImpactAnalysisResponseSchema = z.object({
  summary: z.string().min(1),
  targetPath: z.string().min(1),
  targetSymbol: z.string().optional(),
  affectedFiles: z.array(
    z.object({
      filePath: z.string().min(1),
      symbol: z.string().optional(),
      reason: z.string().min(1),
      confidence: ConfidenceLevelSchema
    })
  ),
  risks: z.array(z.string()).default([]),
  references: z.array(SourceReferenceSchema).default([]),
  limitations: z.array(z.string()).default([])
});

export type ImpactAnalysisResponse = z.infer<typeof ImpactAnalysisResponseSchema>;

export const AIUsageMetricsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative().optional()
});

export type AIUsageMetrics = z.infer<typeof AIUsageMetricsSchema>;

export const VerifiedSourceReferenceSchema = SourceReferenceSchema.extend({
  verified: z.literal(true),
  contentHash: z.string().min(1)
});

export type VerifiedSourceReferenceItem = z.infer<typeof VerifiedSourceReferenceSchema>;

export const AIStreamIpcEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stream:start"),
    requestId: z.string().min(1),
    snapshotId: z.string().min(1),
    model: z.string().min(1),
    provider: z.string().min(1),
    structured: z.boolean(),
    timestamp: z.string().datetime()
  }),
  z.object({
    type: z.literal("stream:delta"),
    requestId: z.string().min(1),
    text: z.string(),
    timestamp: z.string().datetime()
  }),
  z.object({
    type: z.literal("stream:progress"),
    requestId: z.string().min(1),
    stage: z.enum(["verifying", "streaming", "validating"]),
    message: z.string().min(1),
    timestamp: z.string().datetime()
  }),
  z.object({
    type: z.literal("stream:usage"),
    requestId: z.string().min(1),
    usage: AIUsageMetricsSchema,
    timestamp: z.string().datetime()
  }),
  z.object({
    type: z.literal("stream:complete"),
    requestId: z.string().min(1),
    snapshotId: z.string().min(1),
    content: z.string(),
    structuredKind: StructuredResponseKindSchema.optional(),
    structuredData: z.unknown().optional(),
    verifiedReferences: z.array(VerifiedSourceReferenceSchema).optional(),
    model: z.string().min(1),
    provider: z.string().min(1),
    usage: AIUsageMetricsSchema.optional(),
    budget: AITokenBudgetSummarySchema,
    omittedFiles: z.array(z.string()),
    truncatedFiles: z.array(z.string()),
    timestamp: z.string().datetime()
  }),
  z.object({
    type: z.literal("stream:error"),
    requestId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    timestamp: z.string().datetime()
  }),
  z.object({
    type: z.literal("stream:cancelled"),
    requestId: z.string().min(1),
    reason: z.string().min(1),
    timestamp: z.string().datetime()
  })
]);

export type AIStreamIpcEvent = z.infer<typeof AIStreamIpcEventSchema>;

export const ConversationMessageStatusSchema = z.enum([
  "completed",
  "streaming",
  "failed",
  "cancelled"
]);

export const ConversationMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  taskType: AITaskTypeSchema.optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  status: ConversationMessageStatusSchema.default("completed"),
  snapshotId: z.string().optional(),
  references: z.array(VerifiedSourceReferenceSchema).default([]),
  usage: AIUsageMetricsSchema.optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime()
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

export const ConversationSummarySchema = z.object({
  id: z.string().min(1),
  workspaceRoot: z.string().min(1),
  title: z.string().min(1),
  taskType: AITaskTypeSchema,
  model: z.string().min(1),
  messageCount: z.number().int().nonnegative(),
  archived: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationPageSchema = z.object({
  conversation: ConversationSummarySchema,
  messages: z.array(ConversationMessageSchema),
  totalMessages: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  nextCursor: z.number().int().nonnegative().nullable()
});

export type ConversationPage = z.infer<typeof ConversationPageSchema>;

export const AIUsageSummarySchema = z.object({
  totalRequests: z.number().int().nonnegative(),
  succeededRequests: z.number().int().nonnegative(),
  failedRequests: z.number().int().nonnegative(),
  cancelledRequests: z.number().int().nonnegative(),
  providerReportedInputTokens: z.number().int().nonnegative(),
  providerReportedOutputTokens: z.number().int().nonnegative(),
  estimatedInputTokens: z.number().int().nonnegative(),
  averageDurationMs: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
  recentRequests: z.array(
    z.object({
      requestId: z.string().min(1),
      provider: z.string().min(1),
      model: z.string().min(1),
      taskType: AITaskTypeSchema,
      outcome: z.enum(["success", "error", "cancelled"]),
      errorCategory: z.string().nullable(),
      durationMs: z.number().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      usageSource: z.enum(["provider", "estimated"]),
      timestamp: z.string().datetime()
    })
  )
});

export type AIUsageSummary = z.infer<typeof AIUsageSummarySchema>;
