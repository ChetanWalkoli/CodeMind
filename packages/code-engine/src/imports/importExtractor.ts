import path from "node:path";
import ts from "typescript";
import type { ImportKind, ImportRecord } from "@codemind/shared";

const RESOLVABLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json"
];

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === ".."
  );
}

function normalizePosix(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Resolve a relative import specifier against a set of known workspace-relative POSIX file paths.
 * Handles TypeScript ESM `.js` -> `.ts`/`.tsx` mapping, extensionless imports, and `/index.*` barrels.
 */
export function resolveRelativeSpecifier(
  sourceFilePath: string,
  specifier: string,
  knownFiles: ReadonlySet<string>
): string | null {
  if (!isRelativeSpecifier(specifier)) {
    return null;
  }

  const sourceDir = path.posix.dirname(normalizePosix(sourceFilePath));
  const rawJoined = path.posix.normalize(path.posix.join(sourceDir, specifier));

  if (rawJoined.startsWith("..")) {
    return null;
  }

  // 1. Exact match
  if (knownFiles.has(rawJoined)) {
    return rawJoined;
  }

  // 2. TypeScript ESM convention: import "./foo.js" -> "foo.ts" or "foo.tsx"
  if (/\.(m|c)?js$/i.test(rawJoined)) {
    const stem = rawJoined.replace(/\.(m|c)?js$/i, "");
    for (const ext of [".ts", ".tsx", ".mts", ".cts", ".jsx"]) {
      const candidate = `${stem}${ext}`;
      if (knownFiles.has(candidate)) {
        return candidate;
      }
    }
  }

  // 3. Extensionless file
  for (const ext of RESOLVABLE_EXTENSIONS) {
    const candidate = `${rawJoined}${ext}`;
    if (knownFiles.has(candidate)) {
      return candidate;
    }
  }

  // 4. Directory barrel index file
  for (const ext of RESOLVABLE_EXTENSIONS) {
    const candidate = `${rawJoined}/index${ext}`;
    if (knownFiles.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getLine(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * Extract static imports, re-exports, CommonJS require calls, and dynamic imports from an AST.
 */
export function extractImports(
  filePath: string,
  sourceFile: ts.SourceFile,
  knownFiles: ReadonlySet<string>
): ImportRecord[] {
  const records: ImportRecord[] = [];
  const normalizedSource = normalizePosix(filePath);

  const pushImport = (
    specifier: string,
    kind: ImportKind,
    importedNames: string[],
    line: number,
    confidence: "confirmed" | "inferred"
  ) => {
    const isExternal = !isRelativeSpecifier(specifier);
    const resolvedPath = isExternal
      ? null
      : resolveRelativeSpecifier(normalizedSource, specifier, knownFiles);

    records.push({
      sourcePath: normalizedSource,
      specifier,
      resolvedPath,
      isExternal,
      kind,
      importedNames,
      line,
      confidence
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const names: string[] = [];
      const clause = node.importClause;

      if (clause?.name) {
        names.push(clause.name.text);
      }
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          names.push(`* as ${clause.namedBindings.name.text}`);
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            names.push(el.name.text);
          }
        }
      }

      pushImport(specifier, "static-import", names, getLine(sourceFile, node), "confirmed");
      return;
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const names: string[] = [];
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          names.push(el.name.text);
        }
      } else {
        names.push("*");
      }

      pushImport(specifier, "re-export", names, getLine(sourceFile, node), "confirmed");
      return;
    }

    if (ts.isCallExpression(node)) {
      // CommonJS require("...")
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]!)
      ) {
        pushImport(node.arguments[0]!.text, "require", [], getLine(sourceFile, node), "confirmed");
      }

      // Dynamic import("...")
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0]!)
      ) {
        pushImport(
          node.arguments[0]!.text,
          "dynamic-import",
          [],
          getLine(sourceFile, node),
          "inferred"
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return records;
}
