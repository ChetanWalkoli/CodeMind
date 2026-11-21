import ts from "typescript";
import type { CodeSymbol, ExportRecord, SymbolKind } from "@codemind/shared";

export interface SymbolExtractionResult {
  symbols: CodeSymbol[];
  exports: ExportRecord[];
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return Boolean(mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return Boolean(mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword));
}

function getLineRange(
  sourceFile: ts.SourceFile,
  node: ts.Node
): { startLine: number; endLine: number } {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    endLine: Math.max(start.line + 1, end.line + 1)
  };
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const walk = (child: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, walk);
  };
  walk(node);
  return found;
}

function classifyFunctionName(name: string, bodyNode: ts.Node): SymbolKind {
  if (/^use[A-Z]/.test(name)) {
    return "hook";
  }
  if (/^[A-Z]/.test(name) && containsJsx(bodyNode)) {
    return "component";
  }
  return "function";
}

function makeSymbolId(filePath: string, kind: SymbolKind, name: string, startLine: number): string {
  return `${filePath}::${kind}::${name}::${startLine}`;
}

/**
 * Extract top-level and class-member symbols plus export metadata from a TypeScript AST.
 */
export function extractSymbolsAndExports(
  filePath: string,
  sourceFile: ts.SourceFile
): SymbolExtractionResult {
  const symbols: CodeSymbol[] = [];
  const exports: ExportRecord[] = [];

  const addSymbol = (name: string, kind: SymbolKind, node: ts.Node, exported: boolean) => {
    const { startLine, endLine } = getLineRange(sourceFile, node);
    symbols.push({
      id: makeSymbolId(filePath, kind, name, startLine),
      filePath,
      name,
      kind,
      startLine,
      endLine,
      exported
    });
  };

  for (const statement of sourceFile.statements) {
    const isExported = hasExportModifier(statement);
    const isDefault = hasDefaultModifier(statement);
    const { startLine } = getLineRange(sourceFile, statement);

    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? (isDefault ? "default" : "");
      if (name) {
        const kind = classifyFunctionName(name, statement);
        addSymbol(name, kind, statement, isExported);
        if (isExported) {
          exports.push({
            filePath,
            name,
            kind: isDefault ? "default" : "named",
            line: startLine
          });
        }
      }
      continue;
    }

    if (ts.isClassDeclaration(statement)) {
      const className = statement.name?.text ?? (isDefault ? "default" : "");
      if (className) {
        addSymbol(className, "class", statement, isExported);
        if (isExported) {
          exports.push({
            filePath,
            name: className,
            kind: isDefault ? "default" : "named",
            line: startLine
          });
        }

        for (const member of statement.members) {
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = member.name.getText(sourceFile);
            addSymbol(`${className}.${methodName}`, "method", member, isExported);
          }
        }
      }
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      const name = statement.name.text;
      addSymbol(name, "interface", statement, isExported);
      if (isExported) {
        exports.push({ filePath, name, kind: "named", line: startLine });
      }
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      const name = statement.name.text;
      addSymbol(name, "type", statement, isExported);
      if (isExported) {
        exports.push({ filePath, name, kind: "named", line: startLine });
      }
      continue;
    }

    if (ts.isEnumDeclaration(statement)) {
      const name = statement.name.text;
      addSymbol(name, "enum", statement, isExported);
      if (isExported) {
        exports.push({ filePath, name, kind: "named", line: startLine });
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        const init = decl.initializer;

        let kind: SymbolKind = "variable";
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          kind = classifyFunctionName(name, init);
        }

        // Capture exported variables and top-level arrow functions/components/hooks
        if (isExported || kind !== "variable") {
          addSymbol(name, kind, decl, isExported);
        }

        if (isExported) {
          exports.push({ filePath, name, kind: "named", line: startLine });
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const spec of statement.exportClause.elements) {
          exports.push({
            filePath,
            name: spec.name.text,
            kind: statement.moduleSpecifier ? "re-export" : "named",
            line: startLine
          });
        }
      } else if (statement.moduleSpecifier) {
        exports.push({
          filePath,
          name: "*",
          kind: "namespace",
          line: startLine
        });
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      exports.push({
        filePath,
        name: "default",
        kind: "default",
        line: startLine
      });
    }
  }

  return { symbols, exports };
}
