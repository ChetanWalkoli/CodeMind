import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 8_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const MAX_BASELINE_BYTES = 120_000;

export interface GitChangedFile {
  filePath: string;
  previousPath?: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  changeScope: "staged" | "unstaged" | "mixed" | "untracked";
}

export interface GitDiffSummary {
  available: boolean;
  reason?: string;
  changedFiles: GitChangedFile[];
}

export interface GitBaselineContentResult {
  content: string | null;
  isBinary: boolean;
  truncated: boolean;
}

export function isBinaryBuffer(buf: Buffer): boolean {
  const sampleLen = Math.min(buf.length, 8192);
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function runReadOnlyGitText(workspaceRoot: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: workspaceRoot,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true
    });
    return stdout;
  } catch {
    return null;
  }
}

async function runReadOnlyGitBuffer(workspaceRoot: string, args: string[]): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: workspaceRoot,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      encoding: "buffer",
      windowsHide: true
    });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  } catch {
    return null;
  }
}

function normGitPath(raw: string): string {
  return raw
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

/**
 * Strictly read-only Git diff inspection for Phase 8 Change Impact triggers.
 * Uses `execFile("git", ["status", "--porcelain=v1", "-z", "-uall"])` without shell interpolation:
 * - Expands untracked directories into concrete files (`-uall`)
 * - NUL-delimited parsing avoids quoting/escaping bugs for spaces or special characters
 * - Preserves `previousPath` for renames so baseline reads `HEAD:<previousPath>`
 * - Distinguishes staged, unstaged, mixed (staged + unstaged), and untracked changes.
 */
export async function getUncommittedChangedFiles(workspaceRoot: string): Promise<GitDiffSummary> {
  const inside = await runReadOnlyGitText(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside || inside.trim() !== "true") {
    return {
      available: false,
      reason: "Workspace is not a Git repository or Git is unavailable.",
      changedFiles: []
    };
  }

  const rawBuf = await runReadOnlyGitBuffer(workspaceRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "-uall"
  ]);
  if (rawBuf === null) {
    return {
      available: false,
      reason: "Unable to read Git status for this workspace.",
      changedFiles: []
    };
  }

  const rawText = rawBuf.toString("utf8");
  const tokens = rawText.split("\0");
  const changedFiles: GitChangedFile[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry || entry.length < 4) continue;

    const x = entry[0] ?? " ";
    const y = entry[1] ?? " ";
    const filePath = normGitPath(entry.slice(3));
    if (!filePath) continue;

    let previousPath: string | undefined;
    // In porcelain -z, R (rename) and C (copy) entries are followed by a second NUL-terminated original path
    if (x === "R" || y === "R" || x === "C" || y === "C") {
      const orig = tokens[i + 1];
      if (orig) {
        previousPath = normGitPath(orig);
        i += 1;
      }
    }

    if (seen.has(filePath)) continue;
    seen.add(filePath);

    let status: GitChangedFile["status"] = "modified";
    let changeScope: GitChangedFile["changeScope"] = "unstaged";

    if (x === "?" && y === "?") {
      status = "untracked";
      changeScope = "untracked";
    } else {
      const hasStaged = x !== " " && x !== "?";
      const hasUnstaged = y !== " " && y !== "?";
      if (hasStaged && hasUnstaged) changeScope = "mixed";
      else if (hasStaged) changeScope = "staged";
      else changeScope = "unstaged";

      if (x === "R" || y === "R") status = "renamed";
      else if (x === "D" || y === "D") status = "deleted";
      else if (x === "A") status = "added";
      else status = "modified";
    }

    changedFiles.push({ filePath, previousPath, status, changeScope });
  }

  return {
    available: true,
    changedFiles
  };
}

/**
 * Read-only lookup of a file's baseline version from `HEAD` for schema/contract diffing.
 * - Uses `previousPath` for renamed files (`HEAD:<previousPath>`)
 * - Detects binary blobs and omits content safely
 * - Caps baseline size at 120KB to respect IPC/schema bounds
 */
export async function getBaselineFileContent(
  workspaceRoot: string,
  entry: Pick<GitChangedFile, "filePath" | "previousPath" | "status">
): Promise<GitBaselineContentResult> {
  if (entry.status === "untracked" || entry.status === "added") {
    return { content: null, isBinary: false, truncated: false };
  }

  const lookupPath = normGitPath(
    entry.status === "renamed" && entry.previousPath ? entry.previousPath : entry.filePath
  );
  if (!lookupPath || lookupPath.startsWith("..") || lookupPath.startsWith("-")) {
    return { content: null, isBinary: false, truncated: false };
  }

  const buf = await runReadOnlyGitBuffer(workspaceRoot, ["show", `HEAD:${lookupPath}`]);
  if (!buf) {
    return { content: null, isBinary: false, truncated: false };
  }
  if (isBinaryBuffer(buf)) {
    return { content: null, isBinary: true, truncated: false };
  }
  if (buf.length > MAX_BASELINE_BYTES) {
    return {
      content: null,
      isBinary: false,
      truncated: true
    };
  }
  return {
    content: buf.toString("utf8"),
    isBinary: false,
    truncated: false
  };
}

/**
 * Backward-compatible helper returning UTF-8 content from `HEAD:<relativePath>` or null.
 */
export async function getHeadFileContent(
  workspaceRoot: string,
  relativePath: string
): Promise<string | null> {
  const res = await getBaselineFileContent(workspaceRoot, {
    filePath: relativePath,
    status: "modified"
  });
  return res.content;
}
