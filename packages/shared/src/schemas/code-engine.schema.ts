import { z } from "zod";

export const SupportedLanguageSchema = z.enum([
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "css",
  "scss",
  "html",
  "markdown",
  "unknown"
]);

export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export const FileNodeSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  language: SupportedLanguageSchema,
  contentHash: z.string().min(1),
  lastIndexedAt: z.string().datetime()
});

export type FileNode = z.infer<typeof FileNodeSchema>;

export const SymbolKindSchema = z.enum([
  "function",
  "class",
  "interface",
  "type",
  "component",
  "hook",
  "variable",
  "method",
  "enum",
  "unknown"
]);

export type SymbolKind = z.infer<typeof SymbolKindSchema>;

export const CodeSymbolSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  name: z.string().min(1),
  kind: SymbolKindSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  exported: z.boolean()
});

export type CodeSymbol = z.infer<typeof CodeSymbolSchema>;

export const DependencyRelationSchema = z.enum(["imports", "calls", "uses", "extends"]);
export type DependencyRelation = z.infer<typeof DependencyRelationSchema>;

export const RelationshipConfidenceSchema = z.enum(["confirmed", "inferred"]);
export type RelationshipConfidence = z.infer<typeof RelationshipConfidenceSchema>;

export const DependencyEdgeSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relation: DependencyRelationSchema,
  confidence: RelationshipConfidenceSchema
});

export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>;
