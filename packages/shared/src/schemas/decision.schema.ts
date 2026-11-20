import { z } from "zod";

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
