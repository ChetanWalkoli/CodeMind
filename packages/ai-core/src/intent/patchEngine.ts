import crypto from "node:crypto";
import type { PatchLineRange, PatchValidationResult } from "@codemind/shared";

export const MAX_PATCH_BYTES = 256 * 1024;
export const MAX_PATCH_CHANGED_LINES = 2_000;

export interface UnifiedDiffResult {
  unifiedDiff: string;
  changedLineRanges: PatchLineRange[];
  addedLines: number;
  removedLines: number;
}

export function computeContentSha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

/**
 * Deterministic unified diff generator (LCS-backed for moderate files, prefix/suffix fallback
 * for very large files to keep memory bounded). Zero eval, zero external shell dependencies.
 */
export function buildUnifiedDiff(
  filePath: string,
  originalContent: string,
  proposedContent: string,
  contextLines = 3
): UnifiedDiffResult {
  const origLines = splitLines(originalContent);
  const propLines = splitLines(proposedContent);

  if (originalContent.replace(/\r\n/g, "\n") === proposedContent.replace(/\r\n/g, "\n")) {
    return {
      unifiedDiff: `--- a/${filePath}\n+++ b/${filePath}\n`,
      changedLineRanges: [],
      addedLines: 0,
      removedLines: 0
    };
  }

  // Trim identical prefix & suffix for speed and clean minimal hunks
  let prefix = 0;
  const minLen = Math.min(origLines.length, propLines.length);
  while (prefix < minLen && origLines[prefix] === propLines[prefix]) {
    prefix += 1;
  }

  let origEnd = origLines.length;
  let propEnd = propLines.length;
  while (
    origEnd > prefix &&
    propEnd > prefix &&
    origLines[origEnd - 1] === propLines[propEnd - 1]
  ) {
    origEnd -= 1;
    propEnd -= 1;
  }

  const origMid = origLines.slice(prefix, origEnd);
  const propMid = propLines.slice(prefix, propEnd);

  type DiffOp = { kind: "equal" | "del" | "add"; line: string };
  const ops: DiffOp[] = [];

  for (let i = 0; i < prefix; i += 1) {
    ops.push({ kind: "equal", line: origLines[i]! });
  }

  if (origMid.length * propMid.length <= 250_000) {
    // Exact LCS diff for clean line-by-line hunks
    const m = origMid.length;
    const n = propMid.length;
    const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

    for (let i = m - 1; i >= 0; i -= 1) {
      const row = dp[i]!;
      const nextRow = dp[i + 1]!;
      for (let j = n - 1; j >= 0; j -= 1) {
        if (origMid[i] === propMid[j]) {
          row[j] = nextRow[j + 1]! + 1;
        } else {
          row[j] = Math.max(nextRow[j]!, row[j + 1]!);
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (origMid[i] === propMid[j]) {
        ops.push({ kind: "equal", line: origMid[i]! });
        i += 1;
        j += 1;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        ops.push({ kind: "del", line: origMid[i]! });
        i += 1;
      } else {
        ops.push({ kind: "add", line: propMid[j]! });
        j += 1;
      }
    }
    while (i < m) {
      ops.push({ kind: "del", line: origMid[i]! });
      i += 1;
    }
    while (j < n) {
      ops.push({ kind: "add", line: propMid[j]! });
      j += 1;
    }
  } else {
    // Bounded fallback for very large edits
    for (const line of origMid) ops.push({ kind: "del", line });
    for (const line of propMid) ops.push({ kind: "add", line });
  }

  for (let i = origEnd; i < origLines.length; i += 1) {
    ops.push({ kind: "equal", line: origLines[i]! });
  }

  let addedLines = 0;
  let removedLines = 0;
  const changedIndices: number[] = [];
  for (let idx = 0; idx < ops.length; idx += 1) {
    if (ops[idx]!.kind === "add") {
      addedLines += 1;
      changedIndices.push(idx);
    } else if (ops[idx]!.kind === "del") {
      removedLines += 1;
      changedIndices.push(idx);
    }
  }

  // Group changed indices into hunks with contextLines
  const hunks: Array<{ startIdx: number; endIdx: number }> = [];
  for (const idx of changedIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(ops.length - 1, idx + contextLines);
    const prev = hunks[hunks.length - 1];
    if (prev && start <= prev.endIdx + 1) {
      prev.endIdx = Math.max(prev.endIdx, end);
    } else {
      hunks.push({ startIdx: start, endIdx: end });
    }
  }

  const out: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  const changedLineRanges: PatchLineRange[] = [];

  for (const hunk of hunks) {
    let origLineNum = 1;
    let propLineNum = 1;
    for (let k = 0; k < hunk.startIdx; k += 1) {
      if (ops[k]!.kind !== "add") origLineNum += 1;
      if (ops[k]!.kind !== "del") propLineNum += 1;
    }

    let origCount = 0;
    let propCount = 0;
    const body: string[] = [];
    for (let k = hunk.startIdx; k <= hunk.endIdx; k += 1) {
      const op = ops[k]!;
      if (op.kind === "equal") {
        origCount += 1;
        propCount += 1;
        body.push(` ${op.line}`);
      } else if (op.kind === "del") {
        origCount += 1;
        body.push(`-${op.line}`);
      } else {
        propCount += 1;
        body.push(`+${op.line}`);
      }
    }

    out.push(`@@ -${origLineNum},${origCount} +${propLineNum},${propCount} @@`);
    out.push(...body);
    changedLineRanges.push({
      startLine: Math.max(1, origLineNum),
      endLine: Math.max(origLineNum, origLineNum + Math.max(origCount, propCount) - 1)
    });
  }

  return {
    unifiedDiff: out.join("\n"),
    changedLineRanges,
    addedLines,
    removedLines
  };
}

/**
 * Strictly parses and applies a unified diff to `originalContent` in memory.
 * Verifies every context and removed line matches the exact original content.
 * Rejects malformed diffs or mismatched context deterministically.
 */
export function applyUnifiedDiff(
  originalContent: string,
  unifiedDiff: string
): { ok: true; content: string } | { ok: false; error: string } {
  const diffLines = unifiedDiff.replace(/\r\n/g, "\n").split("\n");
  const origLines = splitLines(originalContent);

  const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  const result: string[] = [];
  let origCursor = 0;
  let foundHunk = false;

  let i = 0;
  while (i < diffLines.length) {
    const line = diffLines[i]!;
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.trim() === "") {
      i += 1;
      continue;
    }

    const match = line.match(hunkHeaderRe);
    if (!match) {
      return { ok: false, error: `Malformed unified diff header at line ${i + 1}: "${line}"` };
    }

    foundHunk = true;
    const startOrig = Math.max(0, Number(match[1]) - 1);
    const expectedOrigCount = match[2] !== undefined ? Number(match[2]) : 1;
    const expectedPropCount = match[4] !== undefined ? Number(match[4]) : 1;

    if (startOrig < origCursor || startOrig > origLines.length) {
      return {
        ok: false,
        error: `Hunk start line ${startOrig + 1} is out of order or out of bounds.`
      };
    }

    while (origCursor < startOrig) {
      result.push(origLines[origCursor]!);
      origCursor += 1;
    }

    i += 1;
    let seenOrig = 0;
    let seenProp = 0;

    while (i < diffLines.length && !diffLines[i]!.startsWith("@@ ")) {
      const hLine = diffLines[i]!;
      if (hLine.startsWith(" ")) {
        const expected = hLine.slice(1);
        if (origLines[origCursor] !== expected) {
          return {
            ok: false,
            error: `Context mismatch at original line ${origCursor + 1}.`
          };
        }
        result.push(expected);
        origCursor += 1;
        seenOrig += 1;
        seenProp += 1;
      } else if (hLine.startsWith("-")) {
        const expected = hLine.slice(1);
        if (origLines[origCursor] !== expected) {
          return {
            ok: false,
            error: `Deletion mismatch at original line ${origCursor + 1}.`
          };
        }
        origCursor += 1;
        seenOrig += 1;
      } else if (hLine.startsWith("+")) {
        result.push(hLine.slice(1));
        seenProp += 1;
      } else if (hLine === "\\ No newline at end of file") {
        // valid unified diff marker
      } else if (hLine === "" && i === diffLines.length - 1) {
        break;
      } else {
        return { ok: false, error: `Unexpected diff line prefix at line ${i + 1}: "${hLine}"` };
      }
      i += 1;
    }

    if (seenOrig !== expectedOrigCount || seenProp !== expectedPropCount) {
      return {
        ok: false,
        error: `Hunk line count mismatch (expected -${expectedOrigCount}/+${expectedPropCount}, got -${seenOrig}/+${seenProp}).`
      };
    }
  }

  if (!foundHunk) {
    return { ok: false, error: "Unified diff contains no hunks." };
  }

  while (origCursor < origLines.length) {
    result.push(origLines[origCursor]!);
    origCursor += 1;
  }

  return { ok: true, content: result.join("\n") };
}

/**
 * Validates patch structural constraints (size, encoding, diff integrity, line bounds).
 */
export function validatePatchStructure(params: {
  targetFile: string;
  originalContent: string;
  proposedContent: string;
  unifiedDiff: string;
  addedLines: number;
  removedLines: number;
  maxPatchBytes?: number;
}): PatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const maxBytes = params.maxPatchBytes ?? MAX_PATCH_BYTES;

  if (params.proposedContent.includes("\0")) {
    errors.push("Proposed content contains NUL bytes (binary modification is unsupported).");
  }

  const diffBytes = Buffer.byteLength(params.unifiedDiff, "utf8");
  if (diffBytes > maxBytes) {
    errors.push(`Patch exceeds maximum allowed size (${diffBytes} > ${maxBytes} bytes).`);
  }

  if (params.addedLines + params.removedLines > MAX_PATCH_CHANGED_LINES) {
    errors.push(
      `Patch modifies too many lines (${params.addedLines + params.removedLines} > ${MAX_PATCH_CHANGED_LINES}).`
    );
  }

  if (params.addedLines === 0 && params.removedLines === 0) {
    errors.push("Patch produces no changes to target file.");
  } else {
    const applied = applyUnifiedDiff(params.originalContent, params.unifiedDiff);
    if (!applied.ok) {
      errors.push(`Unified diff failed dry-run verification: ${applied.error}`);
    } else if (
      applied.content.replace(/\r\n/g, "\n") !== params.proposedContent.replace(/\r\n/g, "\n")
    ) {
      errors.push("Dry-run unified diff output does not match proposed file content.");
    }
  }

  if (params.addedLines + params.removedLines > 300) {
    warnings.push("Large patch (>300 changed lines); review carefully before approving.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stale: false
  };
}

/**
 * Detects conflicting or overlapping patches targeting the same file.
 */
export function detectPatchConflicts(
  patches: Array<{ patchId: string; targetFile: string; changedLineRanges: PatchLineRange[] }>
): Array<{ targetFile: string; patchIds: [string, string]; reason: string }> {
  const conflicts: Array<{ targetFile: string; patchIds: [string, string]; reason: string }> = [];
  const byFile = new Map<string, Array<{ patchId: string; changedLineRanges: PatchLineRange[] }>>();

  for (const patch of patches) {
    const list = byFile.get(patch.targetFile) ?? [];
    list.push({ patchId: patch.patchId, changedLineRanges: patch.changedLineRanges });
    byFile.set(patch.targetFile, list);
  }

  for (const [targetFile, list] of byFile.entries()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]!;
        const b = list[j]!;
        const overlaps = a.changedLineRanges.some((ra) =>
          b.changedLineRanges.some((rb) => ra.startLine <= rb.endLine && rb.startLine <= ra.endLine)
        );
        conflicts.push({
          targetFile,
          patchIds: [a.patchId, b.patchId],
          reason: overlaps
            ? `Overlapping line ranges in "${targetFile}".`
            : `Multiple active patch proposals target the same file "${targetFile}".`
        });
      }
    }
  }

  return conflicts;
}
