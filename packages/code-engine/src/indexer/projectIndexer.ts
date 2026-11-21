import path from "node:path";
import type {
  CodeSymbol,
  DependencyEdge,
  DependencyGraphSnapshot,
  ExportRecord,
  FileNode,
  ImportRecord,
  IndexSummary,
  ParseDiagnostic,
  SymbolSearchResult
} from "@codemind/shared";
import { DependencyGraph } from "../graph/dependencyGraph.js";
import { extractImports, resolveRelativeSpecifier } from "../imports/importExtractor.js";
import { parseJsTsSource } from "../parsers/tsParser.js";
import { CodeEngineIgnore } from "../scanner/ignore.js";
import {
  isJsTsLanguage,
  scanSingleFile,
  scanWorkspaceFiles,
  type ScannedFile
} from "../scanner/scanner.js";
import { SearchIndex, type SymbolSearchOptions } from "../search/searchIndex.js";
import { extractSymbolsAndExports } from "../symbols/symbolExtractor.js";

export interface IndexedFileEntry {
  node: FileNode;
  symbols: CodeSymbol[];
  imports: ImportRecord[];
  exports: ExportRecord[];
  diagnostics: ParseDiagnostic[];
}

export interface IncrementalSyncResult {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: number;
  summary: IndexSummary;
}

/**
 * Local-first ProjectIndexer orchestrating scanning, AST parsing, symbol extraction,
 * import resolution, dependency graph construction, search indexing, and incremental updates.
 */
export class ProjectIndexer {
  private readonly workspaceRoot: string;
  private customExcludes: string[];
  private readonly files = new Map<string, IndexedFileEntry>();
  private readonly graph = new DependencyGraph();
  private readonly searchIndex = new SearchIndex();
  private lastDurationMs = 0;
  private lastIndexedAt = new Date().toISOString();

  constructor(workspaceRoot: string, customExcludes: string[] = []) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.customExcludes = [...customExcludes];
  }

  public setCustomExcludes(customExcludes: string[]): void {
    this.customExcludes = [...customExcludes];
  }

  /**
   * Perform a full index of the workspace.
   */
  public async indexWorkspace(): Promise<IndexSummary> {
    const startMs = Date.now();
    this.files.clear();
    this.graph.clear();
    this.searchIndex.clear();

    const scanned = await scanWorkspaceFiles(this.workspaceRoot, {
      customExcludes: this.customExcludes
    });

    const knownFileSet = new Set(scanned.map((s) => s.node.path));

    // Pass 1: Register all file nodes and parse JS/TS ASTs
    for (const item of scanned) {
      this.graph.upsertFile(item.node);
      const entry = this.analyzeScannedFile(item, knownFileSet);
      this.files.set(item.node.path, entry);
      this.searchIndex.setFile(entry.node, entry.symbols);
    }

    // Pass 2: Wire dependency edges across all registered nodes
    for (const entry of this.files.values()) {
      this.wireEdgesForFile(entry);
    }

    this.lastDurationMs = Date.now() - startMs;
    this.lastIndexedAt = new Date().toISOString();
    return this.getSummary();
  }

  /**
   * Incrementally re-index a single modified or newly created file.
   * Only reparses the changed file and refreshes dependent import edges if needed.
   */
  public async updateFile(relativePath: string): Promise<boolean> {
    const posixRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const ignore = CodeEngineIgnore.fromWorkspace(this.workspaceRoot, this.customExcludes);
    const scanned = await scanSingleFile(this.workspaceRoot, posixRel, ignore);

    if (!scanned) {
      this.removeFile(posixRel);
      return false;
    }

    const existing = this.files.get(posixRel);
    if (existing && existing.node.contentHash === scanned.node.contentHash) {
      return false; // Unchanged content hash — skip reparse
    }

    const isNewFile = !existing;
    this.graph.upsertFile(scanned.node);

    const knownFileSet = new Set(this.files.keys());
    knownFileSet.add(posixRel);

    const entry = this.analyzeScannedFile(scanned, knownFileSet);
    this.files.set(posixRel, entry);
    this.searchIndex.setFile(entry.node, entry.symbols);

    this.graph.clearOutgoingEdges(posixRel);
    this.wireEdgesForFile(entry);

    // If a new file appeared, re-resolve unresolved relative imports in other files
    if (isNewFile) {
      this.reResolveUnresolvedImports(knownFileSet);
    }

    this.lastIndexedAt = new Date().toISOString();
    return true;
  }

  /**
   * Remove a deleted file from the index, search index, and dependency graph,
   * and mark any imports that pointed to it as unresolved.
   */
  public removeFile(relativePath: string): boolean {
    const posixRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!this.files.has(posixRel)) {
      return false;
    }

    this.files.delete(posixRel);
    this.searchIndex.removeFile(posixRel);
    this.graph.removeFile(posixRel);

    for (const entry of this.files.values()) {
      for (const imp of entry.imports) {
        if (imp.resolvedPath === posixRel) {
          imp.resolvedPath = null;
        }
      }
    }

    this.lastIndexedAt = new Date().toISOString();
    return true;
  }

  /**
   * Handle a file rename cleanly by removing the old path, indexing the new path,
   * and re-resolving relative imports across the workspace.
   */
  public async renameFile(oldRelativePath: string, newRelativePath: string): Promise<void> {
    this.removeFile(oldRelativePath);
    await this.updateFile(newRelativePath);
    const knownFileSet = new Set(this.files.keys());
    this.reResolveAllRelativeImports(knownFileSet);
  }

  /**
   * Incremental workspace sync: compares content hashes against the existing index,
   * reparsing ONLY added or modified files and dropping deleted files.
   */
  public async syncWorkspace(): Promise<IncrementalSyncResult> {
    const startMs = Date.now();
    const scanned = await scanWorkspaceFiles(this.workspaceRoot, {
      customExcludes: this.customExcludes
    });

    const scannedByPath = new Map(scanned.map((s) => [s.node.path, s]));
    const knownFileSet = new Set(scannedByPath.keys());

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    let unchanged = 0;

    // 1. Remove deleted files
    for (const existingPath of Array.from(this.files.keys())) {
      if (!scannedByPath.has(existingPath)) {
        this.removeFile(existingPath);
        removed.push(existingPath);
      }
    }

    // 2. Upsert added or modified files
    for (const [filePath, item] of scannedByPath.entries()) {
      const existing = this.files.get(filePath);
      if (!existing) {
        this.graph.upsertFile(item.node);
        const entry = this.analyzeScannedFile(item, knownFileSet);
        this.files.set(filePath, entry);
        this.searchIndex.setFile(entry.node, entry.symbols);
        added.push(filePath);
      } else if (existing.node.contentHash !== item.node.contentHash) {
        this.graph.upsertFile(item.node);
        const entry = this.analyzeScannedFile(item, knownFileSet);
        this.files.set(filePath, entry);
        this.searchIndex.setFile(entry.node, entry.symbols);
        updated.push(filePath);
      } else {
        unchanged += 1;
      }
    }

    // 3. Rewire edges for added/updated files (and re-resolve if structure changed)
    if (added.length > 0 || removed.length > 0) {
      this.reResolveAllRelativeImports(knownFileSet);
    } else {
      for (const filePath of updated) {
        const entry = this.files.get(filePath);
        if (entry) {
          this.graph.clearOutgoingEdges(filePath);
          this.wireEdgesForFile(entry);
        }
      }
    }

    this.lastDurationMs = Date.now() - startMs;
    this.lastIndexedAt = new Date().toISOString();

    return {
      added,
      updated,
      removed,
      unchanged,
      summary: this.getSummary()
    };
  }

  private analyzeScannedFile(
    item: ScannedFile,
    knownFileSet: ReadonlySet<string>
  ): IndexedFileEntry {
    if (!isJsTsLanguage(item.node.language)) {
      return {
        node: item.node,
        symbols: [],
        imports: [],
        exports: [],
        diagnostics: []
      };
    }

    const parsed = parseJsTsSource(item.node.path, item.content, item.node.language);
    const { symbols, exports } = extractSymbolsAndExports(item.node.path, parsed.sourceFile);
    const imports = extractImports(item.node.path, parsed.sourceFile, knownFileSet);

    return {
      node: item.node,
      symbols,
      imports,
      exports,
      diagnostics: parsed.diagnostics
    };
  }

  private wireEdgesForFile(entry: IndexedFileEntry): void {
    for (const imp of entry.imports) {
      if (!imp.isExternal && imp.resolvedPath) {
        this.graph.addEdge({
          sourceId: entry.node.id,
          targetId: imp.resolvedPath,
          relation: "imports",
          confidence: imp.confidence
        });
      }
    }
  }

  private reResolveUnresolvedImports(knownFileSet: ReadonlySet<string>): void {
    for (const entry of this.files.values()) {
      let changed = false;
      for (const imp of entry.imports) {
        if (!imp.isExternal && imp.resolvedPath === null) {
          const resolved = resolveRelativeSpecifier(entry.node.path, imp.specifier, knownFileSet);
          if (resolved) {
            imp.resolvedPath = resolved;
            changed = true;
          }
        }
      }
      if (changed) {
        this.graph.clearOutgoingEdges(entry.node.id);
        this.wireEdgesForFile(entry);
      }
    }
  }

  private reResolveAllRelativeImports(knownFileSet: ReadonlySet<string>): void {
    for (const entry of this.files.values()) {
      for (const imp of entry.imports) {
        if (!imp.isExternal) {
          imp.resolvedPath = resolveRelativeSpecifier(entry.node.path, imp.specifier, knownFileSet);
        }
      }
      this.graph.clearOutgoingEdges(entry.node.id);
      this.wireEdgesForFile(entry);
    }
  }

  public getSummary(): IndexSummary {
    let totalSymbols = 0;
    let diagnosticCount = 0;
    for (const entry of this.files.values()) {
      totalSymbols += entry.symbols.length;
      diagnosticCount += entry.diagnostics.length;
    }

    return {
      workspaceRoot: this.workspaceRoot,
      totalFiles: this.files.size,
      indexedFiles: this.files.size,
      totalSymbols,
      totalEdges: this.graph.edgeCount,
      diagnosticCount,
      durationMs: this.lastDurationMs,
      indexedAt: this.lastIndexedAt
    };
  }

  public getFileEntry(relativePath: string): IndexedFileEntry | null {
    const posixRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return this.files.get(posixRel) ?? null;
  }

  public getFileSymbols(relativePath: string): CodeSymbol[] {
    return this.getFileEntry(relativePath)?.symbols ?? [];
  }

  public getFileImports(relativePath: string): ImportRecord[] {
    return this.getFileEntry(relativePath)?.imports ?? [];
  }

  public getFileExports(relativePath: string): ExportRecord[] {
    return this.getFileEntry(relativePath)?.exports ?? [];
  }

  public getAllDiagnostics(): ParseDiagnostic[] {
    const all: ParseDiagnostic[] = [];
    for (const entry of this.files.values()) {
      all.push(...entry.diagnostics);
    }
    return all;
  }

  public getDependencies(relativePath: string): DependencyEdge[] {
    const posixRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return this.graph.getDirectDependencies(posixRel);
  }

  public getDependents(relativePath: string): DependencyEdge[] {
    const posixRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return this.graph.getDirectDependents(posixRel);
  }

  public getTransitiveDependents(relativePath: string, maxDepth = 10): string[] {
    const posixRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return this.graph.getTransitiveDependents(posixRel, maxDepth);
  }

  public getGraphSnapshot(): DependencyGraphSnapshot {
    return this.graph.toSnapshot();
  }

  public searchSymbols(query: string, options?: SymbolSearchOptions): SymbolSearchResult[] {
    return this.searchIndex.searchSymbols(query, options);
  }

  public searchFiles(query: string, limit = 50): FileNode[] {
    return this.searchIndex.searchFiles(query, limit);
  }
}
