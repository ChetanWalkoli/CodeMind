import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectIndexer } from "../index.js";

describe("@codemind/code-engine — Phase 3 Code Intelligence Engine", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codemind-engine-"));

    fs.mkdirSync(path.join(tempDir, "src", "components"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "src", "hooks"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "src", "services"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "src", "utils"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "node_modules", "react"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "dist"), { recursive: true });

    fs.writeFileSync(path.join(tempDir, ".gitignore"), "generated/\n*.log\n", "utf8");
    fs.writeFileSync(path.join(tempDir, ".env"), "SECRET_TOKEN=super-secret", "utf8");
    fs.writeFileSync(
      path.join(tempDir, "node_modules", "react", "index.js"),
      "module.exports = {};"
    );
    fs.writeFileSync(path.join(tempDir, "dist", "app.js"), "console.log('built');");

    fs.writeFileSync(
      path.join(tempDir, "src", "utils", "index.ts"),
      `export function formatUser(name: string): string {\n  return name.trim();\n}\nexport type UserId = string;\n`,
      "utf8"
    );

    fs.writeFileSync(
      path.join(tempDir, "src", "services", "authService.ts"),
      [
        `import { formatUser, type UserId } from "../utils";`,
        `export interface AuthResult { userId: UserId; ok: boolean; }`,
        `export enum AuthRole { Admin = "admin", User = "user" }`,
        `export class AuthService {`,
        `  login(username: string): AuthResult {`,
        `    return { userId: formatUser(username), ok: true };`,
        `  }`,
        `}`,
        `function internalHelper() { return 42; }`
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      path.join(tempDir, "src", "hooks", "useAuth.ts"),
      [
        `import { AuthService } from "../services/authService.js";`,
        `export function useAuth() {`,
        `  const svc = new AuthService();`,
        `  return svc.login("alice");`,
        `}`
      ].join("\n"),
      "utf8"
    );

    fs.writeFileSync(
      path.join(tempDir, "src", "components", "LoginPage.tsx"),
      [
        `import React from "react";`,
        `import { useAuth } from "../hooks/useAuth";`,
        `export const LoginPage = () => {`,
        `  const auth = useAuth();`,
        `  return <main>{auth.userId}</main>;`,
        `};`
      ].join("\n"),
      "utf8"
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("indexes workspace files while excluding node_modules, dist, .gitignore, and .env secrets", async () => {
    const indexer = new ProjectIndexer(tempDir);
    const summary = await indexer.indexWorkspace();

    expect(summary.indexedFiles).toBeGreaterThanOrEqual(4);
    expect(indexer.getFileEntry(".env")).toBeNull();
    expect(indexer.getFileEntry("node_modules/react/index.js")).toBeNull();
    expect(indexer.getFileEntry("dist/app.js")).toBeNull();
    expect(indexer.getFileEntry("src/components/LoginPage.tsx")).not.toBeNull();
  });

  it("extracts functions, classes, methods, interfaces, types, enums, components, and hooks", async () => {
    const indexer = new ProjectIndexer(tempDir);
    await indexer.indexWorkspace();

    const authSymbols = indexer.getFileSymbols("src/services/authService.ts");
    expect(authSymbols.find((s) => s.name === "AuthResult")?.kind).toBe("interface");
    expect(authSymbols.find((s) => s.name === "AuthRole")?.kind).toBe("enum");
    expect(authSymbols.find((s) => s.name === "AuthService")?.kind).toBe("class");
    expect(authSymbols.find((s) => s.name === "AuthService.login")?.kind).toBe("method");
    expect(authSymbols.find((s) => s.name === "internalHelper")?.exported).toBe(false);

    const hookSymbols = indexer.getFileSymbols("src/hooks/useAuth.ts");
    expect(hookSymbols.find((s) => s.name === "useAuth")?.kind).toBe("hook");

    const compSymbols = indexer.getFileSymbols("src/components/LoginPage.tsx");
    expect(compSymbols.find((s) => s.name === "LoginPage")?.kind).toBe("component");
  });

  it("resolves relative imports (including .js -> .ts and barrel index.ts) and builds dependency graph", async () => {
    const indexer = new ProjectIndexer(tempDir);
    await indexer.indexWorkspace();

    const loginImports = indexer.getFileImports("src/components/LoginPage.tsx");
    const reactImport = loginImports.find((i) => i.specifier === "react");
    const hookImport = loginImports.find((i) => i.specifier === "../hooks/useAuth");

    expect(reactImport?.isExternal).toBe(true);
    expect(reactImport?.resolvedPath).toBeNull();
    expect(hookImport?.isExternal).toBe(false);
    expect(hookImport?.resolvedPath).toBe("src/hooks/useAuth.ts");

    // ESM .js -> .ts resolution
    const hookImports = indexer.getFileImports("src/hooks/useAuth.ts");
    expect(hookImports[0]?.resolvedPath).toBe("src/services/authService.ts");

    // Barrel directory resolution (../utils -> src/utils/index.ts)
    const authImports = indexer.getFileImports("src/services/authService.ts");
    expect(authImports[0]?.resolvedPath).toBe("src/utils/index.ts");

    // Direct & transitive dependents of src/utils/index.ts
    const directDeps = indexer.getDependents("src/utils/index.ts").map((e) => e.sourceId);
    expect(directDeps).toEqual(["src/services/authService.ts"]);

    const transitiveDeps = indexer.getTransitiveDependents("src/utils/index.ts");
    expect(transitiveDeps).toEqual([
      "src/components/LoginPage.tsx",
      "src/hooks/useAuth.ts",
      "src/services/authService.ts"
    ]);

    const snapshot = indexer.getGraphSnapshot();
    expect(snapshot.nodes.length).toBeGreaterThanOrEqual(4);
    expect(snapshot.edges.length).toBe(3);
  });

  it("does not crash on malformed source files and records parse diagnostics", async () => {
    fs.writeFileSync(
      path.join(tempDir, "src", "broken.ts"),
      `export function broken( { const x = ;`,
      "utf8"
    );

    const indexer = new ProjectIndexer(tempDir);
    const summary = await indexer.indexWorkspace();

    expect(summary.diagnosticCount).toBeGreaterThan(0);
    expect(indexer.getAllDiagnostics().some((d) => d.filePath === "src/broken.ts")).toBe(true);
    // Other valid files remain indexed cleanly
    expect(indexer.getFileSymbols("src/hooks/useAuth.ts").length).toBeGreaterThan(0);
  });

  it("supports incremental updates, file deletion, file rename, and workspace sync", async () => {
    const indexer = new ProjectIndexer(tempDir);
    await indexer.indexWorkspace();

    // Unchanged update returns false
    expect(await indexer.updateFile("src/hooks/useAuth.ts")).toBe(false);

    // Modify file -> reparsed and new symbol searchable
    fs.writeFileSync(
      path.join(tempDir, "src", "hooks", "useAuth.ts"),
      [
        `import { AuthService } from "../services/authService.js";`,
        `export function useAuth() { return new AuthService(); }`,
        `export function useSessionToken() { return "tok"; }`
      ].join("\n"),
      "utf8"
    );
    expect(await indexer.updateFile("src/hooks/useAuth.ts")).toBe(true);
    expect(indexer.searchSymbols("useSessionToken")).toHaveLength(1);

    // Rename src/utils/index.ts -> src/utils/format.ts and update import
    fs.renameSync(
      path.join(tempDir, "src", "utils", "index.ts"),
      path.join(tempDir, "src", "utils", "format.ts")
    );
    await indexer.renameFile("src/utils/index.ts", "src/utils/format.ts");
    expect(indexer.getFileEntry("src/utils/index.ts")).toBeNull();
    expect(indexer.getFileEntry("src/utils/format.ts")).not.toBeNull();

    // Sync after adding a brand-new file
    fs.writeFileSync(
      path.join(tempDir, "src", "utils", "math.ts"),
      "export function add(a: number, b: number) { return a + b; }\n",
      "utf8"
    );
    const syncRes = await indexer.syncWorkspace();
    expect(syncRes.added).toEqual(["src/utils/math.ts"]);
    expect(syncRes.unchanged).toBeGreaterThanOrEqual(4);
  });

  it("searches symbols with ranking, kind filtering, and exported filtering", async () => {
    const indexer = new ProjectIndexer(tempDir);
    await indexer.indexWorkspace();

    const hooks = indexer.searchSymbols("auth", { kind: "hook" });
    expect(hooks.map((r) => r.symbol.name)).toEqual(["useAuth"]);

    const internalMatches = indexer.searchSymbols("internalHelper", { exportedOnly: true });
    expect(internalMatches).toHaveLength(0);

    const allInternalMatches = indexer.searchSymbols("internalHelper", { exportedOnly: false });
    expect(allInternalMatches).toHaveLength(1);
  });
});
