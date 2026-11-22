import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DecisionGitReferenceSchema, type DecisionGitReference } from "@codemind/shared";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 4_000;
const SAFE_COMMIT_SHA_RE = /^[0-9a-fA-F]{7,40}$/;

async function runReadOnlyGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 512 * 1024
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function isGitRepository(workspaceRoot: string): Promise<boolean> {
  if (!fs.existsSync(workspaceRoot)) return false;
  if (fs.existsSync(path.join(workspaceRoot, ".git"))) return true;
  const res = await runReadOnlyGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  return res === "true";
}

/**
 * Strictly read-only Git commit lookup for Decision Memory (Milestone 7.5).
 * Never creates/amends commits, never switches branches, never pushes/pulls,
 * and degrades gracefully when Git is not initialized.
 */
export async function resolveGitCommitReference(
  workspaceRoot: string,
  rawSha: string
): Promise<DecisionGitReference> {
  const sha = rawSha.trim();
  if (!SAFE_COMMIT_SHA_RE.test(sha)) {
    throw new Error(`Invalid Git commit SHA format: "${sha}".`);
  }

  const isRepo = await isGitRepository(workspaceRoot);
  if (!isRepo) {
    return DecisionGitReferenceSchema.parse({
      commitSha: sha,
      shortSha: sha.slice(0, 7),
      message: "Git repository not initialized in this workspace.",
      author: "unknown",
      date: new Date().toISOString(),
      changedFiles: [],
      verified: false
    });
  }

  const meta = await runReadOnlyGit(workspaceRoot, [
    "show",
    "--no-patch",
    "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI",
    sha
  ]);

  if (!meta) {
    return DecisionGitReferenceSchema.parse({
      commitSha: sha,
      shortSha: sha.slice(0, 7),
      message: "Commit SHA not found in local Git history.",
      author: "unknown",
      date: new Date().toISOString(),
      changedFiles: [],
      verified: false
    });
  }

  const [fullSha, shortSha, subject, author, isoDate] = meta.split("\x1f");
  const filesOut = await runReadOnlyGit(workspaceRoot, [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    fullSha || sha
  ]);

  const changedFiles = filesOut
    ? filesOut
        .split(/\r?\n/)
        .map((f) => f.trim().replace(/\\/g, "/"))
        .filter(Boolean)
        .slice(0, 100)
    : [];

  return DecisionGitReferenceSchema.parse({
    commitSha: fullSha || sha,
    shortSha: shortSha || sha.slice(0, 7),
    message: (subject || "Commit").slice(0, 500),
    author: (author || "unknown").slice(0, 200),
    date: isoDate || new Date().toISOString(),
    changedFiles,
    verified: true
  });
}

export async function listRecentGitCommits(
  workspaceRoot: string,
  limit = 20
): Promise<DecisionGitReference[]> {
  if (!(await isGitRepository(workspaceRoot))) {
    return [];
  }

  const bounded = Math.max(1, Math.min(limit, 50));
  const logOut = await runReadOnlyGit(workspaceRoot, [
    "log",
    `-${bounded}`,
    "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI"
  ]);
  if (!logOut) return [];

  const commits: DecisionGitReference[] = [];
  for (const line of logOut.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [fullSha, shortSha, subject, author, isoDate] = line.split("\x1f");
    if (!fullSha || !SAFE_COMMIT_SHA_RE.test(fullSha)) continue;
    commits.push(
      DecisionGitReferenceSchema.parse({
        commitSha: fullSha,
        shortSha: shortSha || fullSha.slice(0, 7),
        message: (subject || "Commit").slice(0, 500),
        author: (author || "unknown").slice(0, 200),
        date: isoDate || new Date().toISOString(),
        changedFiles: [],
        verified: true
      })
    );
  }
  return commits;
}
