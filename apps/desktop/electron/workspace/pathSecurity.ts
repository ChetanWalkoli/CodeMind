import fs from "node:fs";
import path from "node:path";

export class WorkspaceSecurityError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkspaceSecurityError";
    this.code = code;
  }
}

function normalizeForComparison(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInsideRoot(rootRealPath: string, candidateRealPath: string): boolean {
  const normRoot = normalizeForComparison(rootRealPath);
  const normCandidate = normalizeForComparison(candidateRealPath);
  if (normRoot === normCandidate) {
    return true;
  }
  const rel = path.relative(normRoot, normCandidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Maintains explicitly authorized workspace root directories and enforces
 * strict containment (blocking unauthorized roots, path traversal, and symlink escapes).
 */
export class WorkspaceAuthority {
  private readonly authorizedRoots = new Map<string, string>();

  public authorizeRoot(directoryPath: string): string {
    if (!directoryPath || directoryPath.includes("\0")) {
      throw new WorkspaceSecurityError("INVALID_WORKSPACE_PATH", "Invalid workspace path.");
    }

    const resolved = path.resolve(directoryPath);
    if (!fs.existsSync(resolved)) {
      throw new WorkspaceSecurityError(
        "WORKSPACE_NOT_FOUND",
        `Workspace directory does not exist: ${resolved}`
      );
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new WorkspaceSecurityError(
        "WORKSPACE_INACCESSIBLE",
        `Workspace directory cannot be accessed: ${resolved}`
      );
    }

    if (!stat.isDirectory()) {
      throw new WorkspaceSecurityError(
        "WORKSPACE_NOT_DIRECTORY",
        `Selected path is not a directory: ${resolved}`
      );
    }

    const realRoot = fs.realpathSync(resolved);
    this.authorizedRoots.set(normalizeForComparison(realRoot), realRoot);
    this.authorizedRoots.set(normalizeForComparison(resolved), realRoot);
    return realRoot;
  }

  public isAuthorized(workspaceRoot: string): boolean {
    if (!workspaceRoot || workspaceRoot.includes("\0")) {
      return false;
    }
    return this.authorizedRoots.has(normalizeForComparison(workspaceRoot));
  }

  public getAuthorizedRoot(workspaceRoot: string): string {
    if (!workspaceRoot || workspaceRoot.includes("\0")) {
      throw new WorkspaceSecurityError("UNAUTHORIZED_WORKSPACE", "Invalid workspace root.");
    }
    const realRoot = this.authorizedRoots.get(normalizeForComparison(workspaceRoot));
    if (!realRoot) {
      throw new WorkspaceSecurityError(
        "UNAUTHORIZED_WORKSPACE",
        "Access denied: workspace root has not been authorized."
      );
    }
    return realRoot;
  }

  public resolveSafePath(workspaceRoot: string, relativePath: string): string {
    const realRoot = this.getAuthorizedRoot(workspaceRoot);

    if (relativePath.includes("\0")) {
      throw new WorkspaceSecurityError("INVALID_PATH", "Path contains invalid null byte.");
    }

    const cleaned = relativePath.trim();
    if (cleaned === "" || cleaned === ".") {
      return realRoot;
    }

    if (path.isAbsolute(cleaned) || /^[a-zA-Z]:/.test(cleaned)) {
      throw new WorkspaceSecurityError(
        "PATH_TRAVERSAL",
        "Relative path must not be absolute or contain a drive specifier."
      );
    }

    const candidate = path.resolve(realRoot, cleaned);
    if (!isPathInsideRoot(realRoot, candidate)) {
      throw new WorkspaceSecurityError(
        "PATH_TRAVERSAL",
        "Access denied: path escapes the authorized workspace root."
      );
    }

    // Resolve symlinks on target (if it exists) or nearest existing ancestor.
    if (fs.existsSync(candidate)) {
      const realTarget = fs.realpathSync(candidate);
      if (!isPathInsideRoot(realRoot, realTarget)) {
        throw new WorkspaceSecurityError(
          "SYMLINK_ESCAPE",
          "Access denied: symlink resolves outside the authorized workspace root."
        );
      }
      return realTarget;
    }

    const parentDir = path.dirname(candidate);
    if (fs.existsSync(parentDir)) {
      const realParent = fs.realpathSync(parentDir);
      if (!isPathInsideRoot(realRoot, realParent)) {
        throw new WorkspaceSecurityError(
          "SYMLINK_ESCAPE",
          "Access denied: parent symlink resolves outside the authorized workspace root."
        );
      }
    }

    return candidate;
  }

  public clear(): void {
    this.authorizedRoots.clear();
  }
}
