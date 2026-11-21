import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORE_DIRS, SECRET_FILE_PATTERNS } from "@codemind/config";

interface ParsedRule {
  negated: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
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
      out += escapeRegex(ch);
      i += 1;
    }
  }

  out += "(/.*)?$";
  return new RegExp(out, process.platform === "win32" ? "i" : "");
}

function parseLine(raw: string): ParsedRule | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  let pattern = trimmed;
  let negated = false;
  if (pattern.startsWith("!")) {
    negated = true;
    pattern = pattern.slice(1).trim();
  }
  if (!pattern) return null;

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

  if (!pattern) return null;

  return {
    negated,
    dirOnly,
    regex: globToRegex(pattern, anchored)
  };
}

function matchesWildcard(fileName: string, pattern: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerPattern = pattern.toLowerCase();
  if (!lowerPattern.includes("*")) {
    return lowerName === lowerPattern;
  }
  const regex = new RegExp(`^${lowerPattern.split("*").map(escapeRegex).join(".*")}$`);
  return regex.test(lowerName);
}

export function isIgnoredDirectory(dirName: string): boolean {
  return (DEFAULT_IGNORE_DIRS as readonly string[]).includes(dirName);
}

export function isSecretFilePath(relativePath: string): boolean {
  const baseName = relativePath.replace(/\\/g, "/").split("/").pop() ?? relativePath;
  return SECRET_FILE_PATTERNS.some((pattern) => matchesWildcard(baseName, pattern));
}

export class CodeEngineIgnore {
  private readonly defaultDirs: Set<string>;
  private readonly rules: ParsedRule[];

  constructor(options?: { gitignoreContent?: string; customExcludes?: string[] }) {
    this.defaultDirs = new Set(DEFAULT_IGNORE_DIRS.map((d) => d.toLowerCase()));
    const gitRules = (options?.gitignoreContent ?? "")
      .split(/\r?\n/)
      .map(parseLine)
      .filter((r): r is ParsedRule => r !== null);
    const customRules = (options?.customExcludes ?? "").toString().split(/\r?\n/).filter(Boolean);
    const parsedCustom = (options?.customExcludes ?? [])
      .map(parseLine)
      .filter((r): r is ParsedRule => r !== null);
    void customRules;
    this.rules = [...gitRules, ...parsedCustom];
  }

  public static fromWorkspace(
    workspaceRoot: string,
    customExcludes: string[] = []
  ): CodeEngineIgnore {
    let gitignoreContent = "";
    try {
      const p = path.join(workspaceRoot, ".gitignore");
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        gitignoreContent = fs.readFileSync(p, "utf8");
      }
    } catch {
      // Ignore unreadable .gitignore
    }
    return new CodeEngineIgnore({ gitignoreContent, customExcludes });
  }

  public shouldIgnore(relativePath: string, isDirectory: boolean): boolean {
    const posix = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!posix) return false;

    if (!isDirectory && isSecretFilePath(posix)) {
      return true;
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
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDirectory) {
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
}
