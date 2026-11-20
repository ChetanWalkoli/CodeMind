import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { GitStatus } from "@codemind/shared";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 3000;

async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Safely detects Git repository metadata (branch + clean/modified status)
 * using read-only `git` invocations without shell execution.
 */
export async function detectGitStatus(workspaceRoot: string): Promise<GitStatus> {
  const nonRepo: GitStatus = {
    isGitRepo: false,
    branch: null,
    isDirty: false,
    modifiedCount: 0
  };

  if (!fs.existsSync(workspaceRoot)) {
    return nonRepo;
  }

  const hasLocalGit = fs.existsSync(path.join(workspaceRoot, ".git"));
  const insideWorkTree = await runGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);

  if (insideWorkTree !== "true" && !hasLocalGit) {
    return nonRepo;
  }

  let branch = await runGit(workspaceRoot, ["symbolic-ref", "--short", "HEAD"]);
  if (!branch) {
    const shortHead = await runGit(workspaceRoot, ["rev-parse", "--short", "HEAD"]);
    branch = shortHead ? `detached@${shortHead}` : "HEAD";
  }

  const porcelain = await runGit(workspaceRoot, ["status", "--porcelain"]);
  const lines = porcelain
    ? porcelain
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  return {
    isGitRepo: true,
    branch,
    isDirty: lines.length > 0,
    modifiedCount: lines.length
  };
}
