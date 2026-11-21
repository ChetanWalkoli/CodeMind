import ts from "typescript";
import type { ParseDiagnostic, SupportedLanguage } from "@codemind/shared";

export interface ParsedSourceFile {
  filePath: string;
  language: SupportedLanguage;
  sourceFile: ts.SourceFile;
  diagnostics: ParseDiagnostic[];
}

function getScriptKind(language: SupportedLanguage): ts.ScriptKind {
  switch (language) {
    case "tsx":
      return ts.ScriptKind.TSX;
    case "jsx":
      return ts.ScriptKind.JSX;
    case "javascript":
      return ts.ScriptKind.JS;
    case "typescript":
    default:
      return ts.ScriptKind.TS;
  }
}

/**
 * Safely parse JavaScript/TypeScript/JSX/TSX source code into a TypeScript AST.
 * Malformed source files never throw — syntax errors are captured as ParseDiagnostics.
 */
export function parseJsTsSource(
  filePath: string,
  content: string,
  language: SupportedLanguage
): ParsedSourceFile {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(language)
  );

  // Access internal parseDiagnostics safely if present on the SourceFile.
  const rawDiagnostics =
    (sourceFile as ts.SourceFile & { parseDiagnostics?: ts.DiagnosticWithLocation[] })
      .parseDiagnostics ?? [];

  const diagnostics: ParseDiagnostic[] = rawDiagnostics.map((diag) => {
    const start = diag.start ?? 0;
    const lc = sourceFile.getLineAndCharacterOfPosition(start);
    return {
      filePath,
      message: ts.flattenDiagnosticMessageText(diag.messageText, " "),
      line: lc.line + 1,
      column: lc.character + 1,
      severity: diag.category === ts.DiagnosticCategory.Warning ? "warning" : "error"
    };
  });

  return {
    filePath,
    language,
    sourceFile,
    diagnostics
  };
}
