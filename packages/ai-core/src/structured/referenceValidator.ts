import type { AIContextSnapshot, SourceReference } from "@codemind/shared";

export interface VerifiedSourceReference extends SourceReference {
  verified: true;
  contentHash: string;
}

export interface InvalidSourceReference {
  reference: SourceReference;
  reason: string;
}

export interface SourceReferenceValidationResult {
  valid: boolean;
  verifiedReferences: VerifiedSourceReference[];
  invalidReferences: InvalidSourceReference[];
}

function isCanonicalWorkspaceRelativePath(filePath: string): boolean {
  if (!filePath || filePath.includes("\0") || filePath.includes("\\")) {
    return false;
  }
  if (filePath.startsWith("/") || /^[a-zA-Z]:/.test(filePath)) {
    return false;
  }
  const segments = filePath.split("/");
  return !segments.some((seg) => seg === "" || seg === "." || seg === "..");
}

/**
 * Validates AI-cited source references against the exact approved AIContextSnapshot.
 * Ensures the model cannot invent file paths, out-of-range line numbers, or non-canonical paths.
 */
export function validateSourceReferences(
  references: readonly SourceReference[],
  snapshot: AIContextSnapshot
): SourceReferenceValidationResult {
  const itemsByPath = new Map(snapshot.items.map((item) => [item.filePath, item]));
  const verifiedReferences: VerifiedSourceReference[] = [];
  const invalidReferences: InvalidSourceReference[] = [];

  for (const ref of references) {
    if (!isCanonicalWorkspaceRelativePath(ref.filePath)) {
      invalidReferences.push({
        reference: ref,
        reason: `Non-canonical or unsafe file path "${ref.filePath}".`
      });
      continue;
    }

    const included = itemsByPath.get(ref.filePath);
    if (!included) {
      invalidReferences.push({
        reference: ref,
        reason: `File "${ref.filePath}" was not included in the approved context snapshot.`
      });
      continue;
    }

    const startLine = ref.startLine ?? included.startLine;
    const endLine = ref.endLine ?? startLine;

    if (startLine < included.startLine || endLine > included.endLine || startLine > endLine) {
      invalidReferences.push({
        reference: ref,
        reason: `Line range ${startLine}-${endLine} is outside approved range ${included.startLine}-${included.endLine} for "${ref.filePath}".`
      });
      continue;
    }

    if (ref.symbol && included.symbols.length > 0 && !included.symbols.includes(ref.symbol)) {
      // Allow if symbol appears in actual included source text, otherwise flag as unverified
      if (!included.content.includes(ref.symbol)) {
        invalidReferences.push({
          reference: ref,
          reason: `Symbol "${ref.symbol}" was not found in approved content of "${ref.filePath}".`
        });
        continue;
      }
    }

    verifiedReferences.push({
      ...ref,
      startLine,
      endLine,
      verified: true,
      contentHash: included.contentHash
    });
  }

  return {
    valid: invalidReferences.length === 0,
    verifiedReferences,
    invalidReferences
  };
}
