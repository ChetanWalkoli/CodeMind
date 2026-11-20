import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  FileReadResult,
  FileSearchMatch,
  FileStatResult,
  FileTreeNode,
  FileWriteResult,
  WorkspaceInfo
} from "@codemind/shared";
import { IgnoreMatcher } from "./ignoreRules.js";
import { WorkspaceSecurityError, type WorkspaceAuthority } from "./pathSecurity.js";

const MAX_READABLE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB text safety guard
const MAX_SEARCH_VISITED_ENTRIES = 15_000;

export function computeContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function toPosixRelative(rootPath: string, fullPath: string): string {
  return path.relative(rootPath, fullPath).replace(/\\/g, "/");
}

function getExtension(fileName: string): string | undefined {
  const ext = path.extname(fileName).toLowerCase();
  return ext.length > 0 ? ext : undefined;
}

function isLikelyBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 4096);
  for (let i = 0; i < sampleLength; i += 1) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Local filesystem service scoped strictly to authorized workspace roots.
 */
export class WorkspaceFileService {
  constructor(private readonly authority: WorkspaceAuthority) {}

  public openWorkspace(rootPath: string): WorkspaceInfo {
    const realRoot = this.authority.authorizeRoot(rootPath);
    const name = path.basename(realRoot) || realRoot;
    return {
      rootPath: realRoot,
      name
    };
  }

  public async readDirectory(
    workspaceRoot: string,
    relativeDir = "",
    customExcludes: string[] = []
  ): Promise<FileTreeNode[]> {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const targetDir = this.authority.resolveSafePath(realRoot, relativeDir);
    const matcher = IgnoreMatcher.fromWorkspace(realRoot, customExcludes);

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
    } catch {
      throw new WorkspaceSecurityError(
        "DIRECTORY_UNREADABLE",
        `Cannot read directory: ${relativeDir || "."}`
      );
    }

    const nodes: FileTreeNode[] = [];

    for (const entry of entries) {
      const fullPath = path.join(targetDir, entry.name);
      const relPath = toPosixRelative(realRoot, fullPath);
      const isDir = entry.isDirectory();

      if (matcher.isIgnored(relPath, isDir)) {
        continue;
      }

      if (isDir) {
        let unreadable = false;
        let hasChildren = false;
        try {
          const childEntries = await fs.promises.readdir(fullPath, { withFileTypes: true });
          hasChildren = childEntries.some((child) => {
            const childRel = `${relPath}/${child.name}`;
            return !matcher.isIgnored(childRel, child.isDirectory());
          });
        } catch {
          unreadable = true;
        }

        nodes.push({
          name: entry.name,
          relativePath: relPath,
          kind: "directory",
          unreadable: unreadable || undefined,
          hasChildren
        });
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        let unreadable = false;
        try {
          await fs.promises.access(fullPath, fs.constants.R_OK);
        } catch {
          unreadable = true;
        }

        const isSecret = matcher.isSecretFile(relPath);
        nodes.push({
          name: entry.name,
          relativePath: relPath,
          kind: "file",
          extension: getExtension(entry.name),
          isSecret: isSecret || undefined,
          unreadable: unreadable || undefined
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return nodes;
  }

  public async readFile(workspaceRoot: string, relativePath: string): Promise<FileReadResult> {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const fullPath = this.authority.resolveSafePath(realRoot, relativePath);
    const matcher = IgnoreMatcher.fromWorkspace(realRoot);

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(fullPath);
    } catch {
      throw new WorkspaceSecurityError("FILE_NOT_FOUND", `File not found: ${relativePath}`);
    }

    if (!stat.isFile()) {
      throw new WorkspaceSecurityError("NOT_A_FILE", `Path is not a file: ${relativePath}`);
    }

    if (stat.size > MAX_READABLE_FILE_BYTES) {
      throw new WorkspaceSecurityError(
        "FILE_TOO_LARGE",
        `File exceeds 5 MB editor limit (${Math.round(stat.size / 1024)} KB).`
      );
    }

    const buffer = await fs.promises.readFile(fullPath);
    if (isLikelyBinary(buffer)) {
      throw new WorkspaceSecurityError(
        "BINARY_FILE_UNSUPPORTED",
        `Binary file cannot be opened in the text editor: ${relativePath}`
      );
    }

    const content = buffer.toString("utf8");
    const normalizedRel = toPosixRelative(realRoot, fullPath);

    return {
      relativePath: normalizedRel,
      content,
      contentHash: computeContentHash(content),
      modifiedAtMs: Math.floor(stat.mtimeMs),
      sizeBytes: stat.size,
      isSecret: matcher.isSecretFile(normalizedRel)
    };
  }

  public async writeFile(
    workspaceRoot: string,
    relativePath: string,
    content: string,
    expectedContentHash?: string,
    force = false
  ): Promise<FileWriteResult> {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const fullPath = this.authority.resolveSafePath(realRoot, relativePath);

    if (!force && expectedContentHash) {
      if (fs.existsSync(fullPath)) {
        const currentContent = await fs.promises.readFile(fullPath, "utf8");
        const currentHash = computeContentHash(currentContent);
        if (currentHash !== expectedContentHash) {
          throw new WorkspaceSecurityError(
            "EXTERNAL_MODIFICATION_CONFLICT",
            `File "${relativePath}" was modified on disk since it was opened.`
          );
        }
      }
    }

    const tempPath = `${fullPath}.codemind-${process.pid}-${Date.now()}.tmp`;
    await fs.promises.writeFile(tempPath, content, "utf8");
    await fs.promises.rename(tempPath, fullPath);

    const stat = await fs.promises.stat(fullPath);
    const normalizedRel = toPosixRelative(realRoot, fullPath);

    return {
      relativePath: normalizedRel,
      contentHash: computeContentHash(content),
      modifiedAtMs: Math.floor(stat.mtimeMs),
      sizeBytes: stat.size
    };
  }

  public async statFile(workspaceRoot: string, relativePath: string): Promise<FileStatResult> {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const fullPath = this.authority.resolveSafePath(realRoot, relativePath);

    if (!fs.existsSync(fullPath)) {
      return { exists: false };
    }

    const stat = await fs.promises.stat(fullPath);
    if (!stat.isFile()) {
      return { exists: false };
    }

    if (stat.size > MAX_READABLE_FILE_BYTES) {
      return {
        exists: true,
        modifiedAtMs: Math.floor(stat.mtimeMs)
      };
    }

    const content = await fs.promises.readFile(fullPath, "utf8");
    return {
      exists: true,
      contentHash: computeContentHash(content),
      modifiedAtMs: Math.floor(stat.mtimeMs)
    };
  }

  public async searchFiles(
    workspaceRoot: string,
    query: string,
    maxResults = 100,
    customExcludes: string[] = []
  ): Promise<FileSearchMatch[]> {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const matcher = IgnoreMatcher.fromWorkspace(realRoot, customExcludes);
    const matches: FileSearchMatch[] = [];
    const queue: string[] = [realRoot];
    let visited = 0;

    while (
      queue.length > 0 &&
      matches.length < maxResults &&
      visited < MAX_SEARCH_VISITED_ENTRIES
    ) {
      const currentDir = queue.shift()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        visited += 1;
        if (visited > MAX_SEARCH_VISITED_ENTRIES) {
          break;
        }

        const fullPath = path.join(currentDir, entry.name);
        const relPath = toPosixRelative(realRoot, fullPath);
        const isDir = entry.isDirectory();

        if (matcher.isIgnored(relPath, isDir)) {
          continue;
        }

        if (isDir) {
          queue.push(fullPath);
        } else if (entry.isFile()) {
          if (
            entry.name.toLowerCase().includes(normalizedQuery) ||
            relPath.toLowerCase().includes(normalizedQuery)
          ) {
            matches.push({
              name: entry.name,
              relativePath: relPath,
              extension: getExtension(entry.name)
            });
            if (matches.length >= maxResults) {
              break;
            }
          }
        }
      }
    }

    // Prioritize filename matches before path-only matches
    matches.sort((a, b) => {
      const aNameMatch = a.name.toLowerCase().includes(normalizedQuery) ? 0 : 1;
      const bNameMatch = b.name.toLowerCase().includes(normalizedQuery) ? 0 : 1;
      if (aNameMatch !== bNameMatch) return aNameMatch - bNameMatch;
      return a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: "base" });
    });

    return matches;
  }
}
