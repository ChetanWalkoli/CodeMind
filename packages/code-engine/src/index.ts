export { CodeEngineIgnore, isIgnoredDirectory, isSecretFilePath } from "./scanner/ignore.js";
export {
  computeHash,
  detectLanguage,
  isJsTsLanguage,
  scanSingleFile,
  scanWorkspaceFiles,
  type ScannedFile,
  type ScanOptions
} from "./scanner/scanner.js";
export { parseJsTsSource, type ParsedSourceFile } from "./parsers/tsParser.js";
export {
  extractSymbolsAndExports,
  type SymbolExtractionResult
} from "./symbols/symbolExtractor.js";
export { extractImports, resolveRelativeSpecifier } from "./imports/importExtractor.js";
export { DependencyGraph } from "./graph/dependencyGraph.js";
export { SearchIndex, type SymbolSearchOptions } from "./search/searchIndex.js";
export {
  ProjectIndexer,
  type IncrementalSyncResult,
  type IndexedFileEntry
} from "./indexer/projectIndexer.js";
