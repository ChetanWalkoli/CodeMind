import type { CodeSymbol, FileNode, SymbolKind, SymbolSearchResult } from "@codemind/shared";
import {
  normalizeMorphology,
  scoreCandidateAgainstTerm,
  splitIdentifierTokens,
  type SearchMatchKind
} from "./textNormalization.js";

export interface SymbolSearchOptions {
  kind?: SymbolKind;
  exportedOnly?: boolean;
  limit?: number;
}

export interface FileSearchDetailedResult {
  file: FileNode;
  score: number;
  matchKind: SearchMatchKind;
}

interface IndexedFileTokens {
  file: FileNode;
  baseLower: string;
  pathLower: string;
  baseTokens: string[];
  baseStems: string[];
  pathTokens: string[];
  pathStems: string[];
}

interface IndexedSymbolTokens {
  symbol: CodeSymbol;
  nameLower: string;
  tokens: string[];
  stems: string[];
}

/**
 * In-memory search index over indexed files and extracted symbols,
 * with pre-tokenized identifier splitting, conservative morphological normalization,
 * and bounded Damerau-Levenshtein typo tolerance.
 */
export class SearchIndex {
  private readonly filesByPath = new Map<string, IndexedFileTokens>();
  private readonly symbolsByFile = new Map<string, IndexedSymbolTokens[]>();

  public setFile(file: FileNode, symbols: CodeSymbol[]): void {
    const baseName = file.path.split("/").pop() ?? file.path;
    const baseWithoutExt = baseName.replace(/\.[^.]+$/, "");
    const baseTokens = splitIdentifierTokens(baseWithoutExt);
    const pathTokens = splitIdentifierTokens(file.path.replace(/\.[^.]+$/, ""));

    this.filesByPath.set(file.path, {
      file,
      baseLower: baseName.toLowerCase(),
      pathLower: file.path.toLowerCase(),
      baseTokens,
      baseStems: baseTokens.map(normalizeMorphology),
      pathTokens,
      pathStems: pathTokens.map(normalizeMorphology)
    });

    this.symbolsByFile.set(
      file.path,
      symbols.map((symbol) => {
        const tokens = splitIdentifierTokens(symbol.name);
        return {
          symbol,
          nameLower: symbol.name.toLowerCase(),
          tokens,
          stems: tokens.map(normalizeMorphology)
        };
      })
    );
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

    const queryTokens = splitIdentifierTokens(queryLower);
    const terms = queryTokens.length > 0 ? queryTokens : [queryLower];
    const limit = options.limit ?? 50;
    const matches: SymbolSearchResult[] = [];

    for (const entries of this.symbolsByFile.values()) {
      for (const entry of entries) {
        if (options.kind && entry.symbol.kind !== options.kind) continue;
        if (options.exportedOnly && !entry.symbol.exported) continue;

        let bestScore = scoreCandidateAgainstTerm(
          entry.nameLower,
          entry.tokens,
          entry.stems,
          queryLower
        ).score;

        if (terms.length > 1) {
          let sum = 0;
          let matchedTerms = 0;
          for (const term of terms) {
            const res = scoreCandidateAgainstTerm(entry.nameLower, entry.tokens, entry.stems, term);
            if (res.score > 0) {
              sum += res.score;
              matchedTerms += 1;
            }
          }
          if (matchedTerms > 0) {
            const multiScore = Math.round(sum / terms.length) + matchedTerms * 8;
            bestScore = Math.max(bestScore, multiScore);
          }
        }

        if (bestScore > 0) {
          matches.push({
            symbol: entry.symbol,
            score: bestScore + (entry.symbol.exported ? 5 : 0)
          });
        }
      }
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (
        a.symbol.name.localeCompare(b.symbol.name) ||
        a.symbol.filePath.localeCompare(b.symbol.filePath)
      );
    });

    return matches.slice(0, limit);
  }

  public searchFilesDetailed(query: string, limit = 50): FileSearchDetailedResult[] {
    const queryLower = query.trim().toLowerCase();
    if (!queryLower) return [];

    const queryTokens = splitIdentifierTokens(queryLower);
    const terms = queryTokens.length > 0 ? queryTokens : [queryLower];
    const scored: FileSearchDetailedResult[] = [];

    for (const entry of this.filesByPath.values()) {
      const directBase = scoreCandidateAgainstTerm(
        entry.baseLower,
        entry.baseTokens,
        entry.baseStems,
        queryLower
      );
      const directPath = scoreCandidateAgainstTerm(
        entry.pathLower,
        entry.pathTokens,
        entry.pathStems,
        queryLower
      );

      let bestScore = Math.max(directBase.score * 1.4, directPath.score);
      let bestKind: SearchMatchKind =
        directBase.score * 1.4 >= directPath.score ? directBase.matchKind : directPath.matchKind;

      if (terms.length > 1) {
        let sum = 0;
        let matchedTerms = 0;
        let topKind: SearchMatchKind = "none";

        for (const term of terms) {
          const bRes = scoreCandidateAgainstTerm(
            entry.baseLower,
            entry.baseTokens,
            entry.baseStems,
            term
          );
          const pRes = scoreCandidateAgainstTerm(
            entry.pathLower,
            entry.pathTokens,
            entry.pathStems,
            term
          );
          const termBest = bRes.score >= pRes.score ? bRes : pRes;
          if (termBest.score > 0) {
            sum += termBest.score;
            matchedTerms += 1;
            if (topKind === "none" || termBest.matchKind === "exact") {
              topKind = termBest.matchKind;
            }
          }
        }

        if (matchedTerms > 0) {
          const coverageBonus = matchedTerms === terms.length ? 25 : matchedTerms * 8;
          const combined = Math.round(sum / terms.length) + coverageBonus;
          if (combined > bestScore) {
            bestScore = combined;
            bestKind = topKind;
          }
        }
      }

      if (bestScore > 0) {
        scored.push({ file: entry.file, score: Math.round(bestScore), matchKind: bestKind });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.file.path.localeCompare(b.file.path);
    });

    return scored.slice(0, limit);
  }

  public searchFiles(query: string, limit = 50): FileNode[] {
    return this.searchFilesDetailed(query, limit).map((item) => item.file);
  }
}
