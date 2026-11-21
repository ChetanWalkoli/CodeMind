import { ProjectIndexer } from "@codemind/code-engine";
import {
  ArchitectureOverviewSchema,
  DependencyGraphSnapshotSchema,
  EngineFileIntelRequestSchema,
  EngineGraphRequestSchema,
  EngineIndexRequestSchema,
  EngineSearchSymbolsRequestSchema,
  FileIntelligenceSchema,
  IndexSummarySchema,
  SymbolSearchResultSchema,
  type ArchitectureOverview,
  type DependencyGraphSnapshot,
  type FileIntelligence,
  type IndexSummary,
  type IpcResponse,
  type SymbolSearchResult
} from "@codemind/shared";
import { z } from "zod";
import type { PreferencesStore } from "../../utils/preferences.js";
import { WorkspaceSecurityError, type WorkspaceAuthority } from "../../workspace/pathSecurity.js";

function toErrorResponse<T>(err: unknown, fallbackCode: string): IpcResponse<T> {
  if (err instanceof WorkspaceSecurityError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  return {
    ok: false,
    error: {
      code: fallbackCode,
      message: err instanceof Error ? err.message : "Code engine operation failed."
    }
  };
}

export class CodeEngineManager {
  private readonly indexers = new Map<string, ProjectIndexer>();

  public getOrCreate(authorizedRoot: string, customExcludes: string[] = []): ProjectIndexer {
    const existing = this.indexers.get(authorizedRoot);
    if (existing) {
      existing.setCustomExcludes(customExcludes);
      return existing;
    }
    const created = new ProjectIndexer(authorizedRoot, customExcludes);
    this.indexers.set(authorizedRoot, created);
    return created;
  }

  public get(authorizedRoot: string): ProjectIndexer | null {
    return this.indexers.get(authorizedRoot) ?? null;
  }

  public async notifyFileSaved(authorizedRoot: string, relativePath: string): Promise<void> {
    const indexer = this.indexers.get(authorizedRoot);
    if (!indexer) return;
    await indexer.updateFile(relativePath);
  }
}

export function createEngineHandlers(deps: {
  authority: WorkspaceAuthority;
  preferences: PreferencesStore;
  engineManager: CodeEngineManager;
}) {
  return {
    async indexWorkspace(payload: unknown): Promise<IpcResponse<IndexSummary>> {
      const parsed = EngineIndexRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        const excludes =
          parsed.data.customExcludes ?? deps.preferences.getWorkspaceSession().customExcludes;
        const indexer = deps.engineManager.getOrCreate(realRoot, excludes);

        const summary = parsed.data.incremental
          ? (await indexer.syncWorkspace()).summary
          : await indexer.indexWorkspace();

        return { ok: true, data: IndexSummarySchema.parse(summary) };
      } catch (err) {
        return toErrorResponse(err, "ENGINE_INDEX_FAILED");
      }
    },

    async searchSymbols(payload: unknown): Promise<IpcResponse<SymbolSearchResult[]>> {
      const parsed = EngineSearchSymbolsRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        let indexer = deps.engineManager.get(realRoot);
        if (!indexer) {
          const excludes = deps.preferences.getWorkspaceSession().customExcludes;
          indexer = deps.engineManager.getOrCreate(realRoot, excludes);
          await indexer.indexWorkspace();
        }

        const results = indexer.searchSymbols(parsed.data.query, {
          kind: parsed.data.kind,
          exportedOnly: parsed.data.exportedOnly,
          limit: parsed.data.limit ?? 50
        });

        return { ok: true, data: z.array(SymbolSearchResultSchema).parse(results) };
      } catch (err) {
        return toErrorResponse(err, "ENGINE_SEARCH_SYMBOLS_FAILED");
      }
    },

    async getDependencyGraph(payload: unknown): Promise<IpcResponse<DependencyGraphSnapshot>> {
      const parsed = EngineGraphRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        let indexer = deps.engineManager.get(realRoot);
        if (!indexer) {
          const excludes = deps.preferences.getWorkspaceSession().customExcludes;
          indexer = deps.engineManager.getOrCreate(realRoot, excludes);
          await indexer.indexWorkspace();
        }

        return { ok: true, data: DependencyGraphSnapshotSchema.parse(indexer.getGraphSnapshot()) };
      } catch (err) {
        return toErrorResponse(err, "ENGINE_GRAPH_FAILED");
      }
    },

    async getFileIntelligence(payload: unknown): Promise<IpcResponse<FileIntelligence>> {
      const parsed = EngineFileIntelRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        deps.authority.resolveSafePath(realRoot, parsed.data.relativePath);

        let indexer = deps.engineManager.get(realRoot);
        if (!indexer) {
          const excludes = deps.preferences.getWorkspaceSession().customExcludes;
          indexer = deps.engineManager.getOrCreate(realRoot, excludes);
          await indexer.indexWorkspace();
        }

        const rel = parsed.data.relativePath.replace(/\\/g, "/");
        const entry = indexer.getFileEntry(rel);
        const intel: FileIntelligence = {
          filePath: rel,
          symbols: entry?.symbols ?? [],
          imports: entry?.imports ?? [],
          exports: entry?.exports ?? [],
          dependencies: indexer.getDependencies(rel),
          dependents: indexer.getDependents(rel),
          diagnostics: entry?.diagnostics ?? []
        };

        return { ok: true, data: FileIntelligenceSchema.parse(intel) };
      } catch (err) {
        return toErrorResponse(err, "ENGINE_FILE_INTEL_FAILED");
      }
    },

    async getArchitectureOverview(payload: unknown): Promise<IpcResponse<ArchitectureOverview>> {
      const parsed = EngineGraphRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        };
      }

      try {
        const realRoot = deps.authority.getAuthorizedRoot(parsed.data.workspaceRoot);
        let indexer = deps.engineManager.get(realRoot);
        if (!indexer) {
          const excludes = deps.preferences.getWorkspaceSession().customExcludes;
          indexer = deps.engineManager.getOrCreate(realRoot, excludes);
          await indexer.indexWorkspace();
        }

        return {
          ok: true,
          data: ArchitectureOverviewSchema.parse(indexer.getArchitectureOverview())
        };
      } catch (err) {
        return toErrorResponse(err, "ENGINE_OVERVIEW_FAILED");
      }
    }
  };
}
