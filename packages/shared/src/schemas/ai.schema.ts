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
