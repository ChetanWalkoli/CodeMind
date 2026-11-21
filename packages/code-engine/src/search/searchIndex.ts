import type { CodeSymbol, FileNode, SymbolKind, SymbolSearchResult } from "@codemind/shared";

export interface SymbolSearchOptions {
  kind?: SymbolKind;
  exportedOnly?: boolean;
  limit?: number;
}

function scoreMatch(candidate: string, queryLower: string): number {
  const lower = candidate.toLowerCase();
  if (lower === queryLower) return 100;
  if (lower.startsWith(queryLower)) return 80;
  const idx = lower.indexOf(queryLower);
  if (idx >= 0) {
    return Math.max(20, 60 - idx);
  }
  return 0;
}

/**
 * In-memory search index over indexed files and extracted symbols,
 * supporting incremental updates per file.
 */
export class SearchIndex {
  private readonly filesByPath = new Map<string, FileNode>();
  private readonly symbolsByFile = new Map<string, CodeSymbol[]>();

  public setFile(file: FileNode, symbols: CodeSymbol[]): void {
    this.filesByPath.set(file.path, file);
    this.symbolsByFile.set(file.path, symbols);
  }

  public removeFile(filePath: string): void {
    this.filesByPath.delete(filePath);
    this.symbolsByFile.delete(filePath);
  }

  public clear(): void {
    this.filesByPath.clear();
    this.symbolsByFile.clear();
  }

  public searchSymbols(query: string, options: SymbolSearchOptions = {}): SymbolSearchResult[] {
    const queryLower = query.trim().toLowerCase();
    if (!queryLower) return [];

    const limit = options.limit ?? 50;
    const matches: SymbolSearchResult[] = [];

    for (const symbols of this.symbolsByFile.values()) {
      for (const symbol of symbols) {
        if (options.kind && symbol.kind !== options.kind) continue;
        if (options.exportedOnly && !symbol.exported) continue;

        const score = scoreMatch(symbol.name, queryLower);
        if (score > 0) {
          matches.push({
            symbol,
            score: score + (symbol.exported ? 5 : 0)
          });
        }
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.symbol.name.localeCompare(b.symbol.name);
    });

    return matches.slice(0, limit);
  }

  public searchFiles(query: string, limit = 50): FileNode[] {
    const queryLower = query.trim().toLowerCase();
    if (!queryLower) return [];

    const scored: { file: FileNode; score: number }[] = [];

    for (const file of this.filesByPath.values()) {
      const baseName = file.path.split("/").pop() ?? file.path;
      const nameScore = scoreMatch(baseName, queryLower);
      const pathScore = scoreMatch(file.path, queryLower);
      const best = Math.max(nameScore * 2, pathScore);
      if (best > 0) {
        scored.push({ file, score: best });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.path.localeCompare(b.file.path);
    });

    return scored.slice(0, limit).map((item) => item.file);
  }
}
