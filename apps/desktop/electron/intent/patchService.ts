import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildUnifiedDiff,
  computeContentSha256,
  detectInlineSecrets,
  detectPatchConflicts,
  validatePatchStructure
} from "@codemind/ai-core";
import { CodeEngineIgnore } from "@codemind/code-engine";
import {
  IntentPatchProposalSchema,
  type IntentPatchProposal,
  type IntentSession
} from "@codemind/shared";
import { isSensitiveContextFilePath } from "../ai/contextBuilder.js";
import type { AIProviderManager } from "../ai/providerManager.js";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";

function isLikelyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function inferLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".json": "json",
    ".scss": "scss",
    ".css": "css",
    ".md": "markdown",
    ".py": "python",
    ".go": "go",
    ".rs": "rust"
  };
  return map[ext] ?? "plaintext";
}

function isUnsafeRelativeTarget(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (!trimmed) return "Target file path is empty.";
  if (trimmed.includes("\0")) return "Target file path contains NUL byte.";
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) {
    return `Absolute path "${trimmed}" is rejected.`;
  }
  const normalized = trimmed.replace(/\\/g, "/");
  if (normalized.split("/").some((seg) => seg === "..")) {
    return `Path traversal "${trimmed}" is rejected.`;
  }
  return null;
}

export class PatchSecurityError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PatchSecurityError";
    this.code = code;
  }
}

/**
 * Patch Generation & Validation Service (Milestones 6.5 & 6.6).
 * Generates reviewable unified diffs in memory WITHOUT modifying workspace files.
 * Strictly enforces WorkspaceAuthority, symlink containment, secret exclusion,
 * ignore rules, hash validation, binary rejection, size limits, and conflict detection.
 */
export class PatchService {
  private readonly authority: WorkspaceAuthority;
  private readonly providerManager?: AIProviderManager;

  constructor(deps: { authority: WorkspaceAuthority; providerManager?: AIProviderManager }) {
    this.authority = deps.authority;
    this.providerManager = deps.providerManager;
  }

  public validateTargetFile(params: {
    authorizedRoot: string;
    targetFile: string;
    customExcludes?: string[];
  }): { posixPath: string; canonicalPath: string; rawBuffer: Buffer; originalHash: string } {
    const unsafeReason = isUnsafeRelativeTarget(params.targetFile);
    if (unsafeReason) {
      throw new PatchSecurityError("PATCH_INVALID_PATH", unsafeReason);
    }

    const posixPath = params.targetFile.replace(/\\/g, "/").replace(/^\/+/, "");

    if (isSensitiveContextFilePath(posixPath)) {
      throw new PatchSecurityError(
        "PATCH_SECRET_FILE_BLOCKED",
        `Refusing to generate patch for secret/sensitive file "${posixPath}".`
      );
    }

    const ignore = CodeEngineIgnore.fromWorkspace(
      params.authorizedRoot,
      params.customExcludes ?? []
    );
    if (ignore.shouldIgnore(posixPath, false)) {
      throw new PatchSecurityError(
        "PATCH_EXCLUDED_FILE_BLOCKED",
        `Refusing to generate patch for excluded file "${posixPath}".`
      );
    }

    // Enforce WorkspaceAuthority canonical realpath & symlink containment
    const canonicalPath = this.authority.resolveSafePath(params.authorizedRoot, posixPath);
    const stat = fs.statSync(canonicalPath);
    if (!stat.isFile()) {
      throw new PatchSecurityError(
        "PATCH_NOT_A_FILE",
        `Target "${posixPath}" is not a regular file.`
      );
    }

    const rawBuffer = fs.readFileSync(canonicalPath);
    if (isLikelyBinary(rawBuffer)) {
      throw new PatchSecurityError(
        "PATCH_BINARY_UNSUPPORTED",
        `Binary file "${posixPath}" cannot be patched.`
      );
    }

    const originalHash = computeContentSha256(rawBuffer);
    return { posixPath, canonicalPath, rawBuffer, originalHash };
  }

  public async generateProposals(params: {
    authorizedRoot: string;
    session: IntentSession;
    recommendationIds: string[];
    customExcludes?: string[];
    useAiGeneration?: boolean;
    modelId?: string;
    proposedEdits?: Array<{ targetFile: string; proposedContent: string; summary?: string }>;
  }): Promise<IntentPatchProposal[]> {
    const { authorizedRoot, session, recommendationIds } = params;
    const selectedRecs = session.recommendations.filter((r) =>
      recommendationIds.includes(r.recommendationId)
    );
    if (selectedRecs.length === 0) {
      throw new PatchSecurityError(
        "PATCH_NO_RECOMMENDATIONS",
        "Select at least one valid recommendation before generating patches."
      );
    }

    let editsToBuild = params.proposedEdits ?? [];

    // Optional Gemini-assisted patch synthesis when no explicit edits were supplied
    if (editsToBuild.length === 0 && params.useAiGeneration && this.providerManager) {
      const targetFiles = Array.from(new Set(selectedRecs.flatMap((r) => r.affectedFiles))).slice(
        0,
        3
      );

      const fileContexts: string[] = [];
      for (const rel of targetFiles) {
        const validated = this.validateTargetFile({
          authorizedRoot,
          targetFile: rel,
          customExcludes: params.customExcludes
        });
        const text = validated.rawBuffer.toString("utf8");
        if (detectInlineSecrets(text).length > 0) {
          throw new PatchSecurityError(
            "PATCH_INLINE_SECRET_BLOCKED",
            `Inline secret detected in "${rel}"; cannot send to AI for patch generation.`
          );
        }
        fileContexts.push(`FILE: ${validated.posixPath}\n\`\`\`\n${text.slice(0, 12_000)}\n\`\`\``);
      }

      const provider = this.providerManager.getProvider("gemini");
      const response = await provider.generate({
        model: params.modelId,
        responseFormat: "json",
        maxTokens: 4096,
        messages: [
          {
            role: "system",
            content:
              'Return strict JSON: { "edits": [{ "targetFile": string, "proposedContent": string, "summary": string }] }. Only edit files provided in the prompt. Never output secrets or paths outside the provided list.'
          },
          {
            role: "user",
            content: `Goal: ${session.intent.normalizedGoal}\nRecommendations:\n${selectedRecs
              .map((r) => `- ${r.title}: ${r.description}`)
              .join("\n")}\n\n${fileContexts.join("\n\n")}`
          }
        ]
      });

      const parsed = JSON.parse(response.content) as {
        edits?: Array<{ targetFile?: string; proposedContent?: string; summary?: string }>;
      };
      if (Array.isArray(parsed.edits)) {
        editsToBuild = parsed.edits
          .filter(
            (e): e is { targetFile: string; proposedContent: string; summary?: string } =>
              typeof e.targetFile === "string" && typeof e.proposedContent === "string"
          )
          .slice(0, 5);
      }
    }

    if (editsToBuild.length === 0) {
      throw new PatchSecurityError(
        "PATCH_NO_EDITS_PRODUCED",
        "No valid proposed file edits were produced for the selected recommendations."
      );
    }

    const proposals: IntentPatchProposal[] = [];
    const now = new Date().toISOString();

    for (const edit of editsToBuild) {
      const target = this.validateTargetFile({
        authorizedRoot,
        targetFile: edit.targetFile,
        customExcludes: params.customExcludes
      });

      const originalContent = target.rawBuffer.toString("utf8");
      if (detectInlineSecrets(edit.proposedContent).length > 0) {
        throw new PatchSecurityError(
          "PATCH_PROPOSED_SECRET_BLOCKED",
          `Proposed patch for "${target.posixPath}" contains a potential secret and was blocked.`
        );
      }

      const diff = buildUnifiedDiff(target.posixPath, originalContent, edit.proposedContent);
      const validation = validatePatchStructure({
        targetFile: target.posixPath,
        originalContent,
        proposedContent: edit.proposedContent,
        unifiedDiff: diff.unifiedDiff,
        addedLines: diff.addedLines,
        removedLines: diff.removedLines
      });

      // Check against investigated file hash if present (stale check)
      const invFile = session.investigation?.relevantFiles.find(
        (f) => f.filePath === target.posixPath
      );
      if (invFile && invFile.contentHash !== target.originalHash) {
        validation.warnings.push(
          "File changed on disk since the investigation ran; patch is anchored to current disk hash."
        );
      }

      const proposedFileHash = computeContentSha256(edit.proposedContent);
      const existingCount = session.patches.filter((p) => p.targetFile === target.posixPath).length;

      proposals.push(
        IntentPatchProposalSchema.parse({
          patchId: `patch-${crypto.randomUUID().slice(0, 12)}`,
          intentId: session.intent.intentId,
          recommendationIds,
          targetFile: target.posixPath,
          language: inferLanguage(target.posixPath),
          originalFileHash: target.originalHash,
          proposedFileHash,
          originalContentVersion: existingCount + 1,
          originalContent,
          proposedContent: edit.proposedContent,
          unifiedDiff: diff.unifiedDiff,
          changedLineRanges: diff.changedLineRanges,
          addedLines: diff.addedLines,
          removedLines: diff.removedLines,
          patchSummary:
            edit.summary?.trim() ||
            `Proposed update to ${target.posixPath} (+${diff.addedLines}/-${diff.removedLines} lines).`,
          validation,
          reviewDecision: validation.valid ? "pending" : "invalid",
          generatedAt: now
        })
      );
    }

    // Detect conflicting / overlapping patches across the batch + existing pending/accepted patches
    const activeExisting = session.patches.filter(
      (p) => p.reviewDecision === "pending" || p.reviewDecision === "accepted"
    );
    const conflicts = detectPatchConflicts([...activeExisting, ...proposals]);
    for (const conflict of conflicts) {
      for (const proposal of proposals) {
        if (conflict.patchIds.includes(proposal.patchId)) {
          proposal.validation.valid = false;
          proposal.validation.errors.push(conflict.reason);
          proposal.reviewDecision = "invalid";
        }
      }
    }

    return proposals;
  }

  /**
   * Re-checks whether any patch proposal in a session has become stale on disk.
   */
  public refreshPatchStaleness(
    authorizedRoot: string,
    patches: IntentPatchProposal[]
  ): IntentPatchProposal[] {
    return patches.map((patch) => {
      try {
        const abs = this.authority.resolveSafePath(authorizedRoot, patch.targetFile);
        const currentHash = computeContentSha256(fs.readFileSync(abs));
        const isStale = currentHash !== patch.originalFileHash;
        if (isStale === patch.validation.stale) return patch;
        return {
          ...patch,
          validation: {
            ...patch.validation,
            stale: isStale,
            warnings: isStale
              ? Array.from(
                  new Set([
                    ...patch.validation.warnings,
                    "File modified on disk after patch generation; re-generate and re-review before applying."
                  ])
                )
              : patch.validation.warnings
          }
        };
      } catch {
        return {
          ...patch,
          validation: {
            ...patch.validation,
            stale: true
          }
        };
      }
    });
  }
}
