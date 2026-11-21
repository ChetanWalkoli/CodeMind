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
export {
  SearchIndex,
  type FileSearchDetailedResult,
  type SymbolSearchOptions
} from "./search/searchIndex.js";
export {
  damerauLevenshteinDistance,
  normalizeMorphology,
  scoreCandidateAgainstTerm,
  splitIdentifierTokens,
  type SearchMatchKind,
  type TokenMatchScore
} from "./search/textNormalization.js";
export {
  buildApiRelationships,
  extractApiArtifactsFromFile,
  normalizeApiEndpoint,
  type ApiRelationship,
  type ExtractedApiCall,
  type ExtractedApiHandler,
  type ExtractedRouteMount,
  type HttpMethod
} from "./api/apiRelationshipExtractor.js";
export {
  ProjectIndexer,
  type IncrementalSyncResult,
  type IndexedFileEntry
} from "./indexer/projectIndexer.js";
