import { z } from "zod";

// ============================================================================
// Phase 0 Legacy DecisionRecord (preserved for backward compatibility)
// ============================================================================

export const DecisionStatusSchema = z.enum(["active", "superseded", "invalidated"]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DecisionOriginSchema = z.enum(["verified", "inferred"]);
export type DecisionOrigin = z.infer<typeof DecisionOriginSchema>;

export const DecisionFileSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  contentHash: z.string().min(1)
});

export type DecisionFile = z.infer<typeof DecisionFileSchema>;

export const DecisionRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  context: z.string().min(1),
  reason: z.string().min(1),
  changeSummary: z.string().optional(),
  alternatives: z.array(z.string()).default([]),
  tradeoffs: z.array(z.string()).default([]),
  status: DecisionStatusSchema.default("active"),
  origin: DecisionOriginSchema.default("verified"),
  commitHash: z.string().optional(),
  files: z.array(DecisionFileSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

// ============================================================================
// Phase 7 — Decision Memory Versioned Schemas (Milestones 7.1–7.9)
// ============================================================================

export const DECISION_SCHEMA_VERSION = 1 as const;

export const DecisionCategorySchema = z.enum([
  "architecture",
  "authentication",
  "database",
  "api_design",
  "security",
  "performance",
  "frontend",
  "backend",
  "infrastructure",
  "testing",
  "dependencies",
  "other"
]);
export type DecisionCategory = z.infer<typeof DecisionCategorySchema>;

export const DecisionLifecycleStatusSchema = z.enum([
  "proposed",
  "accepted",
  "superseded",
  "rejected",
  "deprecated"
]);
export type DecisionLifecycleStatus = z.infer<typeof DecisionLifecycleStatusSchema>;

export const DecisionProvenanceSchema = z.enum([
  "verified",
  "developer_stated",
  "inferred",
  "unknown",
  "stale"
]);
export type DecisionProvenance = z.infer<typeof DecisionProvenanceSchema>;

export const DecisionVerificationStateSchema = z.enum([
  "current",
  "stale",
  "partially_stale",
  "superseded",
  "needs_review",
  "unverified"
]);
export type DecisionVerificationState = z.infer<typeof DecisionVerificationStateSchema>;

export const DecisionSourceKindSchema = z.enum([
  "manual",
  "intent_mode",
  "suggestion",
  "ai_assisted_draft"
]);
export type DecisionSourceKind = z.infer<typeof DecisionSourceKindSchema>;

// ---- 7.4 Alternatives & Tradeoffs ----

export const DecisionAlternativeSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).default(""),
  advantages: z.array(z.string().trim().min(1).max(300)).max(15).default([]),
  disadvantages: z.array(z.string().trim().min(1).max(300)).max(15).default([]),
  rejectionReason: z.string().trim().max(500).default(""),
  evaluationStatus: z.enum(["chosen", "considered", "rejected", "deferred"]).default("considered")
});
export type DecisionAlternative = z.infer<typeof DecisionAlternativeSchema>;

export const DecisionTradeoffSchema = z.object({
  id: z.string().min(1),
  benefit: z.string().trim().min(1).max(500),
  cost: z.string().trim().max(500).default(""),
  risk: z.string().trim().max(500).default(""),
  acceptedCompromise: z.string().trim().max(500).default(""),
  longTermImplications: z.string().trim().max(500).default(""),
  reconsiderConditions: z.string().trim().max(500).default("")
});
export type DecisionTradeoff = z.infer<typeof DecisionTradeoffSchema>;

// ---- 7.3 Evidence & Source Linking ----

export const DecisionEvidenceTypeSchema = z.enum([
  "source_file",
  "symbol",
  "code_range",
  "test",
  "git_commit",
  "benchmark",
  "developer_statement",
  "external_reference"
]);
export type DecisionEvidenceType = z.infer<typeof DecisionEvidenceTypeSchema>;

export const DecisionEvidenceSchema = z.object({
  id: z.string().min(1),
  type: DecisionEvidenceTypeSchema,
  filePath: z.string().trim().max(400).optional(),
  symbolName: z.string().trim().max(200).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  contentHash: z.string().trim().max(128).optional(),
  commitSha: z.string().trim().max(64).optional(),
  description: z.string().trim().min(1).max(600),
  verificationStatus: DecisionVerificationStateSchema.default("unverified"),
  provenance: DecisionProvenanceSchema.default("developer_stated"),
  timestamp: z.string().datetime(),
  staleReason: z.string().max(400).nullable().default(null),
  isHistorical: z.boolean().default(false)
});
export type DecisionEvidence = z.infer<typeof DecisionEvidenceSchema>;

// ---- 7.5 Git Commit Integration ----

export const DecisionGitReferenceSchema = z.object({
  commitSha: z.string().trim().min(7).max(64),
  shortSha: z.string().trim().min(7).max(16),
  message: z.string().max(500),
  author: z.string().max(200),
  date: z.string().max(64),
  changedFiles: z.array(z.string().max(400)).max(100).default([]),
  verified: z.boolean().default(false)
});
export type DecisionGitReference = z.infer<typeof DecisionGitReferenceSchema>;

// ---- 7.6 Timeline & History Events ----

export const DecisionHistoryEventTypeSchema = z.enum([
  "created",
  "updated",
  "accepted",
  "superseded",
  "deprecated",
  "rejected",
  "evidence_stale",
  "revalidated",
  "commit_linked"
]);
export type DecisionHistoryEventType = z.infer<typeof DecisionHistoryEventTypeSchema>;

export const DecisionHistoryEventSchema = z.object({
  id: z.string().min(1),
  type: DecisionHistoryEventTypeSchema,
  summary: z.string().min(1).max(400),
  timestamp: z.string().datetime(),
  actor: z.enum(["developer", "system"]).default("developer")
});
export type DecisionHistoryEvent = z.infer<typeof DecisionHistoryEventSchema>;

// ---- 7.1 Primary Engineering Decision Record ----

export const EngineeringDecisionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().trim().min(2).max(200),
  summary: z.string().trim().max(600).default(""),
  context: z.string().trim().max(4_000).default(""),
  problem: z.string().trim().max(2_000).default(""),
  decision: z.string().trim().max(4_000).default(""),
  rationale: z.string().trim().max(4_000).default(""),
  status: DecisionLifecycleStatusSchema.default("proposed"),
  category: DecisionCategorySchema.default("architecture"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable().default(null),
  createdBy: z.string().trim().min(1).max(120).default("developer"),
  source: DecisionSourceKindSchema.default("manual"),
  confidence: DecisionProvenanceSchema.default("developer_stated"),
  tags: z.array(z.string().trim().min(1).max(60)).max(25).default([]),
  alternatives: z.array(DecisionAlternativeSchema).max(20).default([]),
  evidence: z.array(DecisionEvidenceSchema).max(50).default([]),
  tradeoffs: z.array(DecisionTradeoffSchema).max(20).default([]),
  relatedDecisionIds: z.array(z.string().min(1)).max(30).default([]),
  supersededById: z.string().min(1).nullable().default(null),
  relatedIntentId: z.string().min(1).nullable().default(null),
  gitReferences: z.array(DecisionGitReferenceSchema).max(20).default([]),
  verificationStatus: DecisionVerificationStateSchema.default("unverified"),
  history: z.array(DecisionHistoryEventSchema).max(100).default([]),
  schemaVersion: z.literal(DECISION_SCHEMA_VERSION).default(DECISION_SCHEMA_VERSION)
});
export type EngineeringDecision = z.infer<typeof EngineeringDecisionSchema>;

// ---- 7.2 Suggested Decisions ----

export const DecisionSuggestionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  category: DecisionCategorySchema,
  signalType: z.enum([
    "dependency_change",
    "auth_strategy",
    "api_contract",
    "architecture_layer",
    "config_strategy",
    "intent_session"
  ]),
  reason: z.string().min(1),
  relatedFiles: z.array(z.string()).default([]),
  relatedIntentId: z.string().nullable().default(null),
  dismissed: z.boolean().default(false),
  convertedDecisionId: z.string().nullable().default(null),
  detectedAt: z.string().datetime()
});
export type DecisionSuggestion = z.infer<typeof DecisionSuggestionSchema>;

// ---- 7.6 Timeline Entry ----

export const DecisionTimelineEntrySchema = z.object({
  eventId: z.string().min(1),
  decisionId: z.string().min(1),
  decisionTitle: z.string().min(1),
  category: DecisionCategorySchema,
  status: DecisionLifecycleStatusSchema,
  verificationStatus: DecisionVerificationStateSchema,
  eventType: DecisionHistoryEventTypeSchema,
  summary: z.string().min(1),
  evidenceCount: z.number().int().nonnegative(),
  commitShortSha: z.string().nullable(),
  relatedDecisionIds: z.array(z.string()),
  timestamp: z.string().datetime()
});
export type DecisionTimelineEntry = z.infer<typeof DecisionTimelineEntrySchema>;

// ---- 7.7 Search & Retrieval ----

export const DecisionSearchResultSchema = z.object({
  decision: EngineeringDecisionSchema,
  score: z.number(),
  retrievalReasons: z.array(z.string()),
  matchedEvidenceIds: z.array(z.string())
});
export type DecisionSearchResult = z.infer<typeof DecisionSearchResultSchema>;

// ---- 7.8 Ask Why ----

export const AskWhyAnswerSchema = z.object({
  question: z.string().min(1),
  answered: z.boolean(),
  recordedDecision: z.string(),
  reason: z.string(),
  alternatives: z.array(DecisionAlternativeSchema),
  tradeoffs: z.array(DecisionTradeoffSchema),
  evidence: z.array(DecisionEvidenceSchema),
  gitReferences: z.array(DecisionGitReferenceSchema),
  matchedDecisionIds: z.array(z.string()),
  relatedDecisionIds: z.array(z.string()),
  confidence: DecisionProvenanceSchema,
  currentStatus: z.string(),
  verificationStatus: DecisionVerificationStateSchema,
  usedAiSynthesis: z.boolean(),
  honestNotice: z.string().nullable()
});
export type AskWhyAnswer = z.infer<typeof AskWhyAnswerSchema>;

// ---- 7.9 Conflict Detection ----

export const DecisionConflictSchema = z.object({
  conflictId: z.string().min(1),
  kind: z.enum(["incompatible_strategy", "supersession_pending", "missing_dependency"]),
  severity: z.enum(["high", "medium", "low"]),
  decisionIds: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  evidenceSummary: z.string().min(1)
});
export type DecisionConflict = z.infer<typeof DecisionConflictSchema>;
