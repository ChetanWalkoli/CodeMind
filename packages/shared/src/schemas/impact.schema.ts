import { z } from "zod";
import { RelationshipConfidenceSchema } from "./code-engine.schema.js";

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
