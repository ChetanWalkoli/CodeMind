import { z } from "zod";
import {
  ArchitectureOverviewSchema,
  CodeSymbolSchema,
  DependencyEdgeSchema,
  DependencyGraphSnapshotSchema,
  ExportRecordSchema,
  ImportRecordSchema,
  IndexSummarySchema,
  ParseDiagnosticSchema,
  SymbolKindSchema,
  SymbolSearchResultSchema,
  type ArchitectureOverview,
  type CodeSymbol,
  type DependencyEdge,
  type DependencyGraphSnapshot,
  type ExportRecord,
  type ImportRecord,
  type IndexSummary,
  type ParseDiagnostic,
  type SymbolSearchResult
} from "./code-engine.schema.js";

export const IPC_CHANNELS = {
  WORKSPACE_SELECT_FOLDER: "workspace:select-folder",
  WORKSPACE_OPEN: "workspace:open",
  WORKSPACE_GET_LAST: "workspace:get-last",
  WORKSPACE_SAVE_SESSION: "workspace:save-session",
  WORKSPACE_GET_TREE: "workspace:get-tree",
  WORKSPACE_SEARCH_FILES: "workspace:search-files",
  WORKSPACE_GET_GIT_STATUS: "workspace:get-git-status",
  ENGINE_INDEX_WORKSPACE: "engine:index-workspace",
  ENGINE_SEARCH_SYMBOLS: "engine:search-symbols",
  ENGINE_GET_GRAPH: "engine:get-graph",
  ENGINE_GET_FILE_INTEL: "engine:get-file-intel",
  ENGINE_GET_OVERVIEW: "engine:get-overview",
  FILE_READ: "file:read",
  FILE_WRITE: "file:write",
  FILE_STAT: "file:stat",
  APP_GET_INFO: "app:get-info",
  APP_GET_PLATFORM: "app:get-platform",
  APP_HEALTH_CHECK: "app:health-check",
  THEME_GET: "theme:get",
  THEME_SET: "theme:set"
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const FileReadRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  relativePath: z.string().min(1)
});

export type FileReadRequest = z.infer<typeof FileReadRequestSchema>;

export const FileReadResultSchema = z.object({
  relativePath: z.string().min(1),
  content: z.string(),
  contentHash: z.string().min(1),
  modifiedAtMs: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  isSecret: z.boolean()
});

export type FileReadResult = z.infer<typeof FileReadResultSchema>;

export const FileWriteRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  relativePath: z.string().min(1),
  content: z.string(),
  expectedContentHash: z.string().min(1).optional(),
  force: z.boolean().optional()
});

export type FileWriteRequest = z.infer<typeof FileWriteRequestSchema>;

export const FileWriteResultSchema = z.object({
  relativePath: z.string().min(1),
  contentHash: z.string().min(1),
  modifiedAtMs: z.number().nonnegative(),
  sizeBytes: z.number().int().nonnegative()
});

export type FileWriteResult = z.infer<typeof FileWriteResultSchema>;

export const FileStatRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  relativePath: z.string().min(1)
});

export type FileStatRequest = z.infer<typeof FileStatRequestSchema>;

export const FileStatResultSchema = z.object({
  exists: z.boolean(),
  contentHash: z.string().optional(),
  modifiedAtMs: z.number().nonnegative().optional()
});

export type FileStatResult = z.infer<typeof FileStatResultSchema>;

export const WorkspaceInfoSchema = z.object({
  rootPath: z.string().min(1),
  name: z.string().min(1)
});

export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>;

export const WorkspaceOpenRequestSchema = z.object({
  rootPath: z.string().min(1)
});

export type WorkspaceOpenRequest = z.infer<typeof WorkspaceOpenRequestSchema>;

export const FileTreeNodeSchema: z.ZodType<FileTreeNode> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    relativePath: z.string().min(1),
    kind: z.enum(["file", "directory"]),
    extension: z.string().optional(),
    isSecret: z.boolean().optional(),
    unreadable: z.boolean().optional(),
    hasChildren: z.boolean().optional(),
    children: z.array(FileTreeNodeSchema).optional()
  })
);

export interface FileTreeNode {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  extension?: string;
  isSecret?: boolean;
  unreadable?: boolean;
  hasChildren?: boolean;
  children?: FileTreeNode[];
}

export const WorkspaceTreeRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  relativeDir: z.string().optional(),
  customExcludes: z.array(z.string()).optional()
});

export type WorkspaceTreeRequest = z.infer<typeof WorkspaceTreeRequestSchema>;

export const WorkspaceSearchRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(200).optional(),
  customExcludes: z.array(z.string()).optional()
});

export type WorkspaceSearchRequest = z.infer<typeof WorkspaceSearchRequestSchema>;

export const FileSearchMatchSchema = z.object({
  name: z.string().min(1),
  relativePath: z.string().min(1),
  extension: z.string().optional()
});

export type FileSearchMatch = z.infer<typeof FileSearchMatchSchema>;

export const GitStatusRequestSchema = z.object({
  workspaceRoot: z.string().min(1)
});

export type GitStatusRequest = z.infer<typeof GitStatusRequestSchema>;

export const GitStatusSchema = z.object({
  isGitRepo: z.boolean(),
  branch: z.string().nullable(),
  isDirty: z.boolean(),
  modifiedCount: z.number().int().nonnegative()
});

export type GitStatus = z.infer<typeof GitStatusSchema>;

export const PersistedLayoutSchema = z.object({
  sidebarWidth: z.number().int().positive(),
  rightPanelWidth: z.number().int().positive(),
  bottomPanelHeight: z.number().int().positive(),
  sidebarVisible: z.boolean(),
  rightPanelVisible: z.boolean(),
  bottomPanelVisible: z.boolean()
});

export type PersistedLayout = z.infer<typeof PersistedLayoutSchema>;

export const WorkspaceSessionSchema = z.object({
  lastWorkspacePath: z.string().nullable().default(null),
  openTabPaths: z.array(z.string()).default([]),
  activeTabPath: z.string().nullable().default(null),
  customExcludes: z.array(z.string()).default([]),
  layout: PersistedLayoutSchema.optional()
});

export type WorkspaceSession = z.infer<typeof WorkspaceSessionSchema>;

export const AppInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1)
});

export type AppInfo = z.infer<typeof AppInfoSchema>;

export const PlatformInfoSchema = z.object({
  platform: z.string().min(1),
  arch: z.string().min(1),
  electronVersion: z.string().min(1),
  nodeVersion: z.string().min(1),
  chromeVersion: z.string().min(1)
});

export type PlatformInfo = z.infer<typeof PlatformInfoSchema>;

export const ThemePreferenceSchema = z.enum(["dark", "light"]);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const SetThemeRequestSchema = z.object({
  theme: ThemePreferenceSchema
});

export type SetThemeRequest = z.infer<typeof SetThemeRequestSchema>;

export const HealthCheckResponseSchema = z.object({
  status: z.literal("ready"),
  timestamp: z.string().datetime()
});

export type HealthCheckResponse = z.infer<typeof HealthCheckResponseSchema>;

export const IpcErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
});

export type IpcError = z.infer<typeof IpcErrorSchema>;

export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export const EngineIndexRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  incremental: z.boolean().optional(),
  customExcludes: z.array(z.string()).optional()
});

export type EngineIndexRequest = z.infer<typeof EngineIndexRequestSchema>;

export const EngineSearchSymbolsRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  query: z.string().min(1),
  kind: SymbolKindSchema.optional(),
  exportedOnly: z.boolean().optional(),
  limit: z.number().int().positive().max(200).optional()
});

export type EngineSearchSymbolsRequest = z.infer<typeof EngineSearchSymbolsRequestSchema>;

export const EngineGraphRequestSchema = z.object({
  workspaceRoot: z.string().min(1)
});

export type EngineGraphRequest = z.infer<typeof EngineGraphRequestSchema>;

export const EngineFileIntelRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  relativePath: z.string().min(1)
});

export type EngineFileIntelRequest = z.infer<typeof EngineFileIntelRequestSchema>;

export const FileIntelligenceSchema = z.object({
  filePath: z.string().min(1),
  symbols: z.array(CodeSymbolSchema),
  imports: z.array(ImportRecordSchema),
  exports: z.array(ExportRecordSchema),
  dependencies: z.array(DependencyEdgeSchema),
  dependents: z.array(DependencyEdgeSchema),
  diagnostics: z.array(ParseDiagnosticSchema)
});

export type FileIntelligence = {
  filePath: string;
  symbols: CodeSymbol[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  dependencies: DependencyEdge[];
  dependents: DependencyEdge[];
  diagnostics: ParseDiagnostic[];
};

export interface CodeMindDesktopAPI {
  getAppInfo(): Promise<IpcResponse<AppInfo>>;
  getPlatformInfo(): Promise<IpcResponse<PlatformInfo>>;
  healthCheck(): Promise<IpcResponse<HealthCheckResponse>>;
  getTheme(): Promise<IpcResponse<ThemePreference>>;
  setTheme(request: SetThemeRequest): Promise<IpcResponse<ThemePreference>>;
  selectWorkspaceFolder(): Promise<IpcResponse<WorkspaceInfo | null>>;
  openWorkspace(request: WorkspaceOpenRequest): Promise<IpcResponse<WorkspaceInfo>>;
  getWorkspaceSession(): Promise<IpcResponse<WorkspaceSession>>;
  saveWorkspaceSession(session: WorkspaceSession): Promise<IpcResponse<WorkspaceSession>>;
  getWorkspaceTree(request: WorkspaceTreeRequest): Promise<IpcResponse<FileTreeNode[]>>;
  searchWorkspaceFiles(request: WorkspaceSearchRequest): Promise<IpcResponse<FileSearchMatch[]>>;
  getGitStatus(request: GitStatusRequest): Promise<IpcResponse<GitStatus>>;
  indexWorkspace(request: EngineIndexRequest): Promise<IpcResponse<IndexSummary>>;
  searchSymbols(request: EngineSearchSymbolsRequest): Promise<IpcResponse<SymbolSearchResult[]>>;
  getDependencyGraph(request: EngineGraphRequest): Promise<IpcResponse<DependencyGraphSnapshot>>;
  getFileIntelligence(request: EngineFileIntelRequest): Promise<IpcResponse<FileIntelligence>>;
  getArchitectureOverview(request: EngineGraphRequest): Promise<IpcResponse<ArchitectureOverview>>;
  readFile(request: FileReadRequest): Promise<IpcResponse<FileReadResult>>;
  writeFile(request: FileWriteRequest): Promise<IpcResponse<FileWriteResult>>;
  statFile(request: FileStatRequest): Promise<IpcResponse<FileStatResult>>;
}

export {
  ArchitectureOverviewSchema,
  IndexSummarySchema,
  DependencyGraphSnapshotSchema,
  SymbolSearchResultSchema
};
