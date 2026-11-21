import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SUPPORTED_EXTENSIONS } from "@codemind/config";
import type { FileNode, SupportedLanguage } from "@codemind/shared";
import { CodeEngineIgnore } from "./ignore.js";

const MAX_INDEXABLE_FILE_BYTES = 2 * 1024 * 1024; // 2 MB guard per file

export interface ScannedFile {
  node: FileNode;
  absolutePath: string;
  content: string;
}

export interface ScanOptions {
  customExcludes?: string[];
  maxFileBytes?: number;
}

export function detectLanguage(filePath: string): SupportedLanguage {
  const normalized = filePath.toLowerCase();
  for (const [language, extensions] of Object.entries(SUPPORTED_EXTENSIONS)) {
    if (extensions.some((ext) => normalized.endsWith(ext))) {
      return language as SupportedLanguage;
    }
  }
  return "unknown";
}

export function isJsTsLanguage(language: SupportedLanguage): boolean {
  return (
    language === "typescript" ||
    language === "tsx" ||
    language === "javascript" ||
    language === "jsx"
  );
}

export function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function toPosixRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
}

function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, 4096);
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Scan a single file into a ScannedFile record, returning null if ignored, binary, or unreadable.
 */
export async function scanSingleFile(
  workspaceRoot: string,
  relativePath: string,
  ignore: CodeEngineIgnore,
  maxFileBytes = MAX_INDEXABLE_FILE_BYTES
): Promise<ScannedFile | null> {
  const posixRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!posixRel || ignore.shouldIgnore(posixRel, false)) {
    return null;
  }

  const absolutePath = path.resolve(workspaceRoot, posixRel);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch {
    return null;
  }

  if (!stat.isFile() || stat.size > maxFileBytes) {
    return null;
  }

  let buffer: Buffer;
  try {
    buffer = await fs.promises.readFile(absolutePath);
  } catch {
    return null;
  }

  if (isBinaryBuffer(buffer)) {
    return null;
  }

  const content = buffer.toString("utf8");
  const language = detectLanguage(posixRel);
  const now = new Date().toISOString();

  return {
    node: {
      id: posixRel,
      path: posixRel,
      language,
      contentHash: computeHash(content),
      lastIndexedAt: now
    },
    absolutePath,
    content
  };
}

/**
 * Recursively discover and hash all indexable files in a local workspace,
 * respecting default ignores, `.gitignore`, custom exclusions, and secret-file rules.
 */
export async function scanWorkspaceFiles(
  workspaceRoot: string,
  options: ScanOptions = {}
): Promise<ScannedFile[]> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const ignore = CodeEngineIgnore.fromWorkspace(resolvedRoot, options.customExcludes ?? []);
  const maxFileBytes = options.maxFileBytes ?? MAX_INDEXABLE_FILE_BYTES;
  const results: ScannedFile[] = [];
  const queue: string[] = [resolvedRoot];

  while (queue.length > 0) {
    const currentDir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = toPosixRelative(resolvedRoot, fullPath);
      const isDir = entry.isDirectory();

      if (ignore.shouldIgnore(relPath, isDir)) {
        continue;
      }

      if (isDir) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        const scanned = await scanSingleFile(resolvedRoot, relPath, ignore, maxFileBytes);
        if (scanned) {
          results.push(scanned);
        }
      }
    }
  }

  results.sort((a, b) => a.node.path.localeCompare(b.node.path));
  return results;
}
