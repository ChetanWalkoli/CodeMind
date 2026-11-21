import fs from "node:fs";
import { CodeEngineIgnore, type ProjectIndexer } from "@codemind/code-engine";
import type { ResolvedMissingFile } from "@codemind/shared";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";
import { isSensitiveContextFilePath } from "./contextBuilder.js";

function cleanSuggestedPath(raw: string): string {
  return raw
    .trim()
    .replace(/^[`'"([{]+|[`'"\])},.;:]+$/g, "")
    .replace(/:\d+(?:-\d+)?$/, "")
    .replace(/\\/g, "/");
}

function isTraversalOrAbsolute(cleaned: string): boolean {
  if (!cleaned || cleaned.includes("\0")) return true;
  if (/^[a-zA-Z]:\//.test(cleaned)) return true;
  if (cleaned.startsWith("//") || cleaned.startsWith("/")) {
    // Allow leading slash ONLY if it is a workspace-relative style path like "/backend/routes/quiz.js"
    // Reject obvious system absolute paths like "/etc/passwd", "/Users/...", "/Windows/..."
    if (/^\/(?:etc|usr|var|bin|sbin|root|home|Users|Windows|Program Files)\b/i.test(cleaned)) {
      return true;
    }
  }
  const segments = cleaned.split("/");
  return segments.some((seg) => seg === "..");
}

export interface ResolveMissingFilesParams {
  authorizedRoot: string;
  indexer: ProjectIndexer;
  authority: WorkspaceAuthority;
  customExcludes?: string[];
  includedFilePaths?: string[];
  suggestedPaths: string[];
}

/**
 * Safely validates and classifies model-suggested missing file paths against the
 * indexed workspace. Never reads file contents, never auto-approves, and strictly
 * blocks traversal, secret files, and ignored paths.
 */
export function resolveMissingFileSuggestions(
  params: ResolveMissingFilesParams
): ResolvedMissingFile[] {
  const { authorizedRoot, indexer, authority, suggestedPaths } = params;
  const ignore = CodeEngineIgnore.fromWorkspace(authorizedRoot, params.customExcludes ?? []);
  const includedSet = new Set(
    (params.includedFilePaths ?? []).map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
  );

  const allIndexedPaths = indexer.getAllFilePaths();
  const indexedSet = new Set(allIndexedPaths);
  const lowerToExact = new Map<string, string>();
  for (const indexed of allIndexedPaths) {
    lowerToExact.set(indexed.toLowerCase(), indexed);
  }

  const results: ResolvedMissingFile[] = [];
  const seenRequested = new Set<string>();
  const seenResolved = new Set<string>();

  const verifySafeFile = (candidatePath: string): "ok" | "security" | "not-found" => {
    if (isSensitiveContextFilePath(candidatePath)) {
      return "security";
    }
    if (ignore.shouldIgnore(candidatePath, false)) {
      return "security";
    }
    try {
      const abs = authority.resolveSafePath(authorizedRoot, candidatePath);
      const stat = fs.statSync(abs);
      return stat.isFile() ? "ok" : "not-found";
    } catch {
      return "security";
    }
  };

  for (const rawPath of suggestedPaths.slice(0, 30)) {
    const cleaned = cleanSuggestedPath(rawPath);
    if (!cleaned) continue;

    const dedupeKey = cleaned.toLowerCase();
    if (seenRequested.has(dedupeKey)) continue;
    seenRequested.add(dedupeKey);

    if (isTraversalOrAbsolute(cleaned)) {
      results.push({
        requestedPath: rawPath,
        resolvedPath: null,
        status: "excluded-security",
        reason: "Blocked path traversal or system-absolute path."
      });
      continue;
    }

    const normalized = cleaned.replace(/^\.?\//, "").replace(/\/+$/, "");
    if (!normalized) {
      results.push({
        requestedPath: rawPath,
        resolvedPath: null,
        status: "unsupported",
        reason: "Invalid or empty file path."
      });
      continue;
    }

    if (isSensitiveContextFilePath(normalized)) {
      results.push({
        requestedPath: rawPath,
        resolvedPath: null,
        status: "excluded-security",
        reason: "Sensitive or secret file cannot be included in AI context."
      });
      continue;
    }

    if (ignore.shouldIgnore(normalized, false)) {
      results.push({
        requestedPath: rawPath,
        resolvedPath: null,
        status: "excluded-security",
        reason: "Ignored path cannot be included in AI context."
      });
      continue;
    }

    if (includedSet.has(normalized)) {
      results.push({
        requestedPath: rawPath,
        resolvedPath: normalized,
        status: "already-included",
        reason: "Already included in the current context snapshot."
      });
      continue;
    }

    // 1. Exact match in indexed workspace (case-insensitive fallback for Windows)
    const exactMatch = indexedSet.has(normalized)
      ? normalized
      : lowerToExact.get(normalized.toLowerCase());

    if (exactMatch) {
      const check = verifySafeFile(exactMatch);
      if (check === "ok") {
        if (!seenResolved.has(exactMatch)) {
          seenResolved.add(exactMatch);
          results.push({
            requestedPath: rawPath,
            resolvedPath: exactMatch,
            status: "exact-match",
            reason: "Verified indexed file inside workspace."
          });
        }
      } else if (check === "security") {
        results.push({
          requestedPath: rawPath,
          resolvedPath: null,
          status: "excluded-security",
          reason: "Blocked by workspace security or ignore rules."
        });
      } else {
        results.push({
          requestedPath: rawPath,
          resolvedPath: null,
          status: "not-found",
          reason: "File does not exist on disk."
        });
      }
      continue;
    }

    // 2. Directory prefix suggestion (e.g. "backend/routes" or "backend/controllers/")
    const dirPrefix = `${normalized.toLowerCase()}/`;
    const dirMatches = allIndexedPaths
      .filter((p) => p.toLowerCase().startsWith(dirPrefix))
      .filter((p) => !includedSet.has(p) && !seenResolved.has(p));

    if (dirMatches.length > 0) {
      let addedFromDir = 0;
      for (const match of dirMatches.slice(0, 4)) {
        if (verifySafeFile(match) === "ok") {
          seenResolved.add(match);
          results.push({
            requestedPath: rawPath,
            resolvedPath: match,
            status: "similar-match",
            reason: `Indexed file inside suggested directory "${normalized}/".`
          });
          addedFromDir += 1;
        }
      }
      if (addedFromDir > 0) continue;
    }

    // 3. Suffix or basename match (e.g. "quizService.js" -> "backend/services/quizService.js")
    const lowerNorm = normalized.toLowerCase();
    const suffixMatches = allIndexedPaths.filter((p) => {
      const lowerP = p.toLowerCase();
      return lowerP.endsWith(`/${lowerNorm}`) || lowerP === lowerNorm;
    });

    if (suffixMatches.length === 1) {
      const match = suffixMatches[0];
      if (!match) continue;
      if (includedSet.has(match)) {
        results.push({
          requestedPath: rawPath,
          resolvedPath: match,
          status: "already-included",
          reason: "Already included in the current context snapshot."
        });
        continue;
      }
      if (verifySafeFile(match) === "ok") {
        if (!seenResolved.has(match)) {
          seenResolved.add(match);
          results.push({
            requestedPath: rawPath,
            resolvedPath: match,
            status: "similar-match",
            reason: `Matched indexed workspace file "${match}".`
          });
        }
        continue;
      }
    }

    // 4. Not found
    results.push({
      requestedPath: rawPath,
      resolvedPath: null,
      status: "not-found",
      reason: "Path not found in indexed workspace files."
    });
  }

  return results;
}
