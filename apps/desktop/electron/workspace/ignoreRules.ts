import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORE_DIRS, SECRET_FILE_PATTERNS } from "@codemind/config";

interface ParsedIgnoreRule {
  pattern: string;
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
  regex: RegExp;
}

function escapeRegexChar(ch: string): string {
  return ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(glob: string, anchored: boolean): RegExp {
  let out = anchored ? "^" : "(^|/)";
  let i = 0;

  while (i < glob.length) {
    const ch = glob[i]!;
    const next = glob[i + 1];

    if (ch === "*" && next === "*") {
      if (glob[i + 2] === "/") {
        out += "(.*/)?";
        i += 3;
      } else {
        out += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      out += "[^/]*";
      i += 1;
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else {
      out += escapeRegexChar(ch);
      i += 1;
    }
  }

  out += "(/.*)?$";
  return new RegExp(out, process.platform === "win32" ? "i" : "");
}

function parseRuleLine(rawLine: string): ParsedIgnoreRule | null {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  let pattern = trimmed;
  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1).trim();
  }

  if (!pattern) {
    return null;
  }

  let dirOnly = false;
  if (pattern.endsWith("/")) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }

  let anchored = false;
  if (pattern.startsWith("/")) {
    anchored = true;
    pattern = pattern.slice(1);
  } else if (pattern.includes("/")) {
    anchored = true;
  }

  if (!pattern) {
    return null;
  }

  return {
    pattern,
    negated,
    dirOnly,
    anchored,
    regex: globToRegex(pattern, anchored)
  };
}

function toPosix(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function matchesSecretPattern(fileName: string, pattern: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerPattern = pattern.toLowerCase();
  if (!lowerPattern.includes("*")) {
    return lowerName === lowerPattern;
  }
  const regex = new RegExp(`^${lowerPattern.split("*").map(escapeRegexChar).join(".*")}$`);
  return regex.test(lowerName);
}

/**
 * Evaluates default ignore directories, `.gitignore` rules, custom user excludes,
 * and secret-bearing file patterns.
 */
export class IgnoreMatcher {
  private readonly defaultDirs: Set<string>;
  private readonly gitignoreRules: ParsedIgnoreRule[];
  private readonly customRules: ParsedIgnoreRule[];

  constructor(options?: { gitignoreContent?: string; customExcludes?: string[] }) {
    this.defaultDirs = new Set(DEFAULT_IGNORE_DIRS.map((d) => d.toLowerCase()));
    this.gitignoreRules = (options?.gitignoreContent ?? "")
      .split(/\r?\n/)
      .map(parseRuleLine)
      .filter((r): r is ParsedIgnoreRule => r !== null);

    this.customRules = (options?.customExcludes ?? [])
      .map(parseRuleLine)
      .filter((r): r is ParsedIgnoreRule => r !== null);
  }

  public static fromWorkspace(workspaceRoot: string, customExcludes: string[] = []): IgnoreMatcher {
    let gitignoreContent = "";
    try {
      const gitignorePath = path.join(workspaceRoot, ".gitignore");
      if (fs.existsSync(gitignorePath) && fs.statSync(gitignorePath).isFile()) {
        gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
      }
    } catch {
      // Unreadable .gitignore should not break workspace loading.
    }
    return new IgnoreMatcher({ gitignoreContent, customExcludes });
  }

  public isIgnored(relativePath: string, isDirectory: boolean): boolean {
    const posix = toPosix(relativePath);
    if (!posix) {
      return false;
    }

    const segments = posix.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]!;
      const segIsDir = isDirectory || i < segments.length - 1;
      if (segIsDir && this.defaultDirs.has(seg.toLowerCase())) {
        return true;
      }
    }

    let ignored = false;
    for (const rule of [...this.gitignoreRules, ...this.customRules]) {
      if (rule.dirOnly && !isDirectory) {
        // Still match if a parent directory matches the rule
        const parentPosix = segments.slice(0, -1).join("/");
        if (!parentPosix || !rule.regex.test(parentPosix)) {
          continue;
        }
      } else if (!rule.regex.test(posix)) {
        continue;
      }
      ignored = !rule.negated;
    }

    return ignored;
  }

  public isSecretFile(relativePath: string): boolean {
    const posix = toPosix(relativePath);
    const baseName = posix.split("/").pop() ?? posix;
    return SECRET_FILE_PATTERNS.some((pattern) => matchesSecretPattern(baseName, pattern));
  }
}
