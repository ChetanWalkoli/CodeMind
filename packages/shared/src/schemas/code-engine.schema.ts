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

export const ImportKindSchema = z.enum(["static-import", "re-export", "require", "dynamic-import"]);

export type ImportKind = z.infer<typeof ImportKindSchema>;

export const ImportRecordSchema = z.object({
  sourcePath: z.string().min(1),
  specifier: z.string().min(1),
  resolvedPath: z.string().nullable(),
  isExternal: z.boolean(),
  kind: ImportKindSchema,
  importedNames: z.array(z.string()),
  line: z.number().int().positive(),
  confidence: RelationshipConfidenceSchema
});

export type ImportRecord = z.infer<typeof ImportRecordSchema>;

export const ExportKindSchema = z.enum(["named", "default", "re-export", "namespace"]);
export type ExportKind = z.infer<typeof ExportKindSchema>;

export const ExportRecordSchema = z.object({
  filePath: z.string().min(1),
  name: z.string().min(1),
  kind: ExportKindSchema,
  line: z.number().int().positive()
});

export type ExportRecord = z.infer<typeof ExportRecordSchema>;

export const ParseDiagnosticSchema = z.object({
  filePath: z.string().min(1),
  message: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  severity: z.enum(["error", "warning"])
});

export type ParseDiagnostic = z.infer<typeof ParseDiagnosticSchema>;

export const IndexSummarySchema = z.object({
  workspaceRoot: z.string().min(1),
  totalFiles: z.number().int().nonnegative(),
  indexedFiles: z.number().int().nonnegative(),
  totalSymbols: z.number().int().nonnegative(),
  totalEdges: z.number().int().nonnegative(),
  diagnosticCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  indexedAt: z.string().datetime()
});

export type IndexSummary = z.infer<typeof IndexSummarySchema>;

export const DependencyGraphSnapshotSchema = z.object({
  nodes: z.array(FileNodeSchema),
  edges: z.array(DependencyEdgeSchema)
});

export type DependencyGraphSnapshot = z.infer<typeof DependencyGraphSnapshotSchema>;

export const SymbolSearchResultSchema = z.object({
  symbol: CodeSymbolSchema,
  score: z.number().nonnegative()
});

export type SymbolSearchResult = z.infer<typeof SymbolSearchResultSchema>;

export const LanguageCountSchema = z.object({
  language: SupportedLanguageSchema,
  count: z.number().int().nonnegative()
});

export type LanguageCount = z.infer<typeof LanguageCountSchema>;

export const ModuleGroupSummarySchema = z.object({
  name: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  symbolCount: z.number().int().nonnegative()
});

export type ModuleGroupSummary = z.infer<typeof ModuleGroupSummarySchema>;

export const ExternalPackageUsageSchema = z.object({
  name: z.string().min(1),
  importCount: z.number().int().positive()
});

export type ExternalPackageUsage = z.infer<typeof ExternalPackageUsageSchema>;

export const ArchitectureOverviewSchema = z.object({
  workspaceRoot: z.string().min(1),
  totalFiles: z.number().int().nonnegative(),
  totalSymbols: z.number().int().nonnegative(),
  totalInternalEdges: z.number().int().nonnegative(),
  unresolvedImportCount: z.number().int().nonnegative(),
  diagnosticCount: z.number().int().nonnegative(),
  languages: z.array(LanguageCountSchema),
  modules: z.array(ModuleGroupSummarySchema),
  externalPackages: z.array(ExternalPackageUsageSchema),
  indexedAt: z.string().datetime()
});

export type ArchitectureOverview = z.infer<typeof ArchitectureOverviewSchema>;
