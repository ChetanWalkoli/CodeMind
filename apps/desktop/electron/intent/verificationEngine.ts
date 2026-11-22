import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "@codemind/ai-core";
import {
  VerificationCandidateCommandSchema,
  VerificationRunRecordSchema,
  type VerificationCandidateCommand,
  type VerificationCommandKind,
  type VerificationRunRecord
} from "@codemind/shared";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 32_768;

// Explicitly allowed script names / patterns discovered from package.json
const ALLOWED_SCRIPT_KINDS: Array<{ re: RegExp; kind: VerificationCommandKind; label: string }> = [
  { re: /^test(?::(?:unit|integration|ci))?$/i, kind: "test", label: "Run Tests" },
  { re: /^(?:typecheck|check-types|tsc)$/i, kind: "typecheck", label: "TypeScript Typecheck" },
  { re: /^lint(?::check)?$/i, kind: "lint", label: "Run Linter" },
  { re: /^format:check$/i, kind: "format", label: "Check Formatting" },
  { re: /^build$/i, kind: "build", label: "Project Build" }
];

// Dangerous shell / destructive patterns that are ALWAYS flagged unsafe
const UNSAFE_SCRIPT_BODY_PATTERNS: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[sqf]/i,
  /\bformat\s+[a-z]:/i,
  /\bcurl\b.*\|\s*(?:sh|bash|powershell)/i,
  /\bwget\b.*\|\s*(?:sh|bash)/i,
  /\bgit\s+(?:push|reset\s+--hard|clean\s+-fd)/i,
  /\bpublish\b/i,
  /\bdeploy\b/i
];

function detectPackageManager(workspaceRoot: string): "pnpm" | "yarn" | "npm" {
  if (fs.existsSync(path.join(workspaceRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(workspaceRoot, "yarn.lock"))) return "yarn";
  return "npm";
}

function parseTestCounts(output: string): { passed: number | null; failed: number | null } {
  // Matches Vitest / Jest style summaries: "Tests  12 passed" / "2 failed"
  const passedMatch = output.match(/\b(\d+)\s+passed\b/i);
  const failedMatch = output.match(/\b(\d+)\s+failed\b/i);
  return {
    passed: passedMatch ? Number(passedMatch[1]) : null,
    failed: failedMatch ? Number(failedMatch[1]) : null
  };
}

export class VerificationSecurityError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VerificationSecurityError";
    this.code = code;
  }
}

/**
 * Deterministic Local Verification Engine (Milestone 6.8).
 * - Discovers candidate verification scripts from the authorized workspace's package.json.
 * - Never executes AI-generated shell commands or arbitrary shell interpolation.
 * - Requires explicit user approval (`approvedByUser: true`) before running any command.
 * - Enforces workspace root containment, timeouts, output truncation, secret redaction, and cancellation.
 */
export class VerificationEngine {
  private readonly authority: WorkspaceAuthority;
  private readonly activeProcesses = new Map<string, { proc: ChildProcess; cancelled: boolean }>();

  constructor(authority: WorkspaceAuthority) {
    this.authority = authority;
  }

  public discoverCommands(authorizedRoot: string): VerificationCandidateCommand[] {
    const pkgPath = this.authority.resolveSafePath(authorizedRoot, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return [];
    }

    let pkgJson: { scripts?: Record<string, unknown> };
    try {
      pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        scripts?: Record<string, unknown>;
      };
    } catch {
      return [];
    }

    const scripts = pkgJson.scripts;
    if (!scripts || typeof scripts !== "object") {
      return [];
    }

    const pm = detectPackageManager(authorizedRoot);
    const executable = process.platform === "win32" ? `${pm}.cmd` : pm;
    const candidates: VerificationCandidateCommand[] = [];

    for (const [scriptName, scriptValue] of Object.entries(scripts)) {
      if (typeof scriptValue !== "string") continue;
      if (!/^[a-zA-Z0-9:_-]+$/.test(scriptName)) continue;

      const matched = ALLOWED_SCRIPT_KINDS.find((rule) => rule.re.test(scriptName));
      if (!matched) continue;

      const unsafePattern = UNSAFE_SCRIPT_BODY_PATTERNS.find((re) => re.test(scriptValue));
      const args = pm === "npm" ? ["run", scriptName] : [scriptName];

      candidates.push(
        VerificationCandidateCommandSchema.parse({
          commandId: `cmd-${scriptName}`,
          label: `${matched.label} (${scriptName})`,
          kind: matched.kind,
          executable,
          args,
          displayCommand: `${pm} ${args.join(" ")}`,
          scriptSource: `package.json:scripts.${scriptName}`,
          workingDirectory: authorizedRoot,
          safe: !unsafePattern,
          blockedReason: unsafePattern
            ? `Script body matched blocked safety rule (${unsafePattern.source}).`
            : null
        })
      );
    }

    return candidates.sort((a, b) => a.commandId.localeCompare(b.commandId));
  }

  public async runApprovedCommand(params: {
    authorizedRoot: string;
    intentId: string;
    transactionId?: string;
    commandId: string;
    approvedByUser: boolean;
    timeoutMs?: number;
    verificationId?: string;
  }): Promise<VerificationRunRecord> {
    if (!params.approvedByUser) {
      throw new VerificationSecurityError(
        "VERIFICATION_APPROVAL_REQUIRED",
        "Explicit user approval is required before executing any verification command."
      );
    }

    const candidates = this.discoverCommands(params.authorizedRoot);
    const candidate = candidates.find((c) => c.commandId === params.commandId);
    if (!candidate) {
      throw new VerificationSecurityError(
        "VERIFICATION_COMMAND_NOT_DISCOVERED",
        `Verification command "${params.commandId}" was not found in authorized workspace package.json.`
      );
    }

    if (!candidate.safe) {
      throw new VerificationSecurityError(
        "VERIFICATION_COMMAND_BLOCKED",
        candidate.blockedReason ?? "Verification command blocked by safety policy."
      );
    }

    const verificationId = params.verificationId ?? `ver-${crypto.randomUUID().slice(0, 12)}`;
    const approvedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const timeoutMs = Math.min(params.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, 300_000);

    return new Promise<VerificationRunRecord>((resolve) => {
      let stdout = "";
      let stderr = "";
      let outputTruncated = false;
      let timedOut = false;

      const appendBounded = (current: string, chunk: string): string => {
        if (current.length >= MAX_OUTPUT_CHARS) {
          outputTruncated = true;
          return current;
        }
        const remaining = MAX_OUTPUT_CHARS - current.length;
        if (chunk.length > remaining) {
          outputTruncated = true;
          return current + chunk.slice(0, remaining);
        }
        return current + chunk;
      };

      // Execute without shell interpolation on POSIX; on Windows .cmd shims require cmd.exe /c with
      // strictly validated alphanumeric script names (already verified by /^[a-zA-Z0-9:_-]+$/).
      const proc =
        process.platform === "win32"
          ? spawn("cmd.exe", ["/d", "/s", "/c", candidate.executable, ...candidate.args], {
              cwd: params.authorizedRoot,
              windowsHide: true,
              stdio: ["ignore", "pipe", "pipe"]
            })
          : spawn(candidate.executable, candidate.args, {
              cwd: params.authorizedRoot,
              shell: false,
              stdio: ["ignore", "pipe", "pipe"]
            });

      const entry = { proc, cancelled: false };
      this.activeProcesses.set(verificationId, entry);

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
      }, timeoutMs);

      proc.stdout?.on("data", (buf: Buffer) => {
        stdout = appendBounded(stdout, buf.toString("utf8"));
      });

      proc.stderr?.on("data", (buf: Buffer) => {
        stderr = appendBounded(stderr, buf.toString("utf8"));
      });

      const finish = (exitCode: number | null, spawnErr?: Error) => {
        clearTimeout(timer);
        this.activeProcesses.delete(verificationId);

        const endedAtMs = Date.now();
        const safeStdout = redactSecrets(stdout);
        const safeStderr = redactSecrets(
          spawnErr ? `${stderr}\n${spawnErr.message}`.trim() : stderr
        );
        const counts = parseTestCounts(`${safeStdout}\n${safeStderr}`);

        let status: VerificationRunRecord["status"];
        let errorSummary: string | null = null;
        if (entry.cancelled) {
          status = "cancelled";
          errorSummary = "Verification command was cancelled by user.";
        } else if (timedOut) {
          status = "timed_out";
          errorSummary = `Verification command timed out after ${timeoutMs}ms.`;
        } else if (spawnErr) {
          status = "failed";
          errorSummary = redactSecrets(spawnErr.message);
        } else if (exitCode === 0) {
          status = "passed";
        } else {
          status = "failed";
          errorSummary = `Command exited with code ${exitCode ?? "unknown"}.`;
        }

        resolve(
          VerificationRunRecordSchema.parse({
            verificationId,
            intentId: params.intentId,
            transactionId: params.transactionId ?? null,
            commandId: candidate.commandId,
            displayCommand: candidate.displayCommand,
            kind: candidate.kind,
            approvedByUser: true,
            approvedAt,
            startedAt,
            endedAt: new Date(endedAtMs).toISOString(),
            durationMs: endedAtMs - startedAtMs,
            exitCode,
            status,
            stdout: safeStdout,
            stderr: safeStderr,
            outputTruncated,
            timedOut,
            passedCount: counts.passed,
            failedCount: counts.failed,
            errorSummary
          })
        );
      };

      proc.on("error", (err) => finish(null, err));
      proc.on("close", (code) => finish(code));
    });
  }

  public cancel(verificationId: string): boolean {
    const entry = this.activeProcesses.get(verificationId);
    if (!entry) return false;
    entry.cancelled = true;
    try {
      entry.proc.kill("SIGTERM");
    } catch {
      // ignore
    }
    return true;
  }
}
