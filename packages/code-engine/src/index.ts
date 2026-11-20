import { DEFAULT_IGNORE_DIRS, SUPPORTED_EXTENSIONS } from "@codemind/config";
import type { SupportedLanguage } from "@codemind/shared";

/**
 * Detect supported language from a file path extension.
 * Full scanner, AST parser, symbol extractor, dependency graph, and impact modules
 * will be implemented in Phase 3 and Phase 8.
 */
export function detectLanguage(filePath: string): SupportedLanguage {
  const normalized = filePath.toLowerCase();
  for (const [language, extensions] of Object.entries(SUPPORTED_EXTENSIONS)) {
    if (extensions.some((ext) => normalized.endsWith(ext))) {
      return language as SupportedLanguage;
    }
  }
  return "unknown";
}

/**
 * Determine whether a directory segment should be excluded by default ignore rules.
 */
export function isIgnoredDirectory(dirName: string): boolean {
  return (DEFAULT_IGNORE_DIRS as readonly string[]).includes(dirName);
}
