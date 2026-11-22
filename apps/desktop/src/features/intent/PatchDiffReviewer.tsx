import { DiffEditor } from "@monaco-editor/react";
import { AlertTriangle, Check, FileDiff, X } from "lucide-react";
import type { IntentPatchProposal } from "@codemind/shared";
import { ensureMonacoConfigured } from "../../components/editor/monacoSetup";
import { useThemeStore } from "../../stores/theme.store";
import styles from "./IntentMode.module.scss";

interface PatchDiffReviewerProps {
  patches: IntentPatchProposal[];
  selectedPatchId: string | null;
  busy: boolean;
  onSelectPatch: (patchId: string) => void;
  onReviewPatches: (patchIds: string[], decision: "accepted" | "rejected") => void;
  onProceedToApply: () => void;
}

export function PatchDiffReviewer({
  patches,
  selectedPatchId,
  busy,
  onSelectPatch,
  onReviewPatches,
  onProceedToApply
}: PatchDiffReviewerProps) {
  ensureMonacoConfigured();
  const theme = useThemeStore((s) => s.theme);

  if (patches.length === 0) {
    return (
      <div className={styles.card} data-testid="intent-diff-empty">
        <p className={styles.muted}>
          No patch proposals generated yet. Approve one or more recommendations and generate patches
          to inspect diffs here.
        </p>
      </div>
    );
  }

  const activePatch = patches.find((p) => p.patchId === selectedPatchId) ?? patches[0]!;
  const validPatchIds = patches
    .filter((p) => p.validation.valid && !p.validation.stale)
    .map((p) => p.patchId);
  const acceptedPatches = patches.filter(
    (p) => p.reviewDecision === "accepted" && p.validation.valid && !p.validation.stale
  );

  return (
    <div className={styles.card} data-testid="intent-diff-reviewer">
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>
            Diff Review ({patches.length} proposed patch file(s))
          </h3>
          <p className={styles.muted}>
            Accepting a patch registers your review decision only — no workspace files are modified
            until explicit transaction approval &amp; application.
          </p>
        </div>
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={busy || validPatchIds.length === 0}
            onClick={() => onReviewPatches(validPatchIds, "accepted")}
          >
            <Check size={12} aria-hidden="true" />
            <span>Accept All Valid</span>
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            disabled={busy}
            onClick={() =>
              onReviewPatches(
                patches.map((p) => p.patchId),
                "rejected"
              )
            }
          >
            <X size={12} aria-hidden="true" />
            <span>Reject All</span>
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={busy || acceptedPatches.length === 0}
            onClick={onProceedToApply}
          >
            <span>Proceed to Approval ({acceptedPatches.length})</span>
          </button>
        </div>
      </div>

      <div className={styles.diffLayout}>
        <div className={styles.diffFileList} role="list" aria-label="Proposed patch files">
          {patches.map((patch) => {
            const isSelected = patch.patchId === activePatch.patchId;
            return (
              <button
                key={patch.patchId}
                type="button"
                className={`${styles.sessionItem} ${isSelected ? styles.sessionItemActive : ""}`}
                onClick={() => onSelectPatch(patch.patchId)}
                data-testid={`patch-file-${patch.patchId}`}
              >
                <div className={styles.sessionBtn}>
                  <span className={styles.sessionGoal}>
                    <FileDiff size={11} aria-hidden="true" /> {patch.targetFile}
                  </span>
                  <div className={styles.sessionMeta}>
                    <span className={styles.badge}>
                      +{patch.addedLines} / -{patch.removedLines}
                    </span>
                    <span
                      className={`${styles.badge} ${
                        patch.reviewDecision === "accepted"
                          ? styles.badgeSuccess
                          : patch.reviewDecision === "rejected" ||
                              patch.reviewDecision === "invalid"
                            ? styles.badgeError
                            : ""
                      }`}
                    >
                      {patch.reviewDecision}
                    </span>
                    {patch.validation.stale && (
                      <span className={`${styles.badge} ${styles.badgeWarn}`}>stale</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className={styles.diffEditorWrap}>
          <div className={styles.cardHeader}>
            <div>
              <strong>{activePatch.targetFile}</strong>
              <p className={styles.muted}>{activePatch.patchSummary}</p>
            </div>
            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.successBtn}
                disabled={busy || !activePatch.validation.valid || activePatch.validation.stale}
                onClick={() => onReviewPatches([activePatch.patchId], "accepted")}
              >
                <Check size={12} aria-hidden="true" />
                <span>Accept File</span>
              </button>
              <button
                type="button"
                className={styles.dangerBtn}
                disabled={busy}
                onClick={() => onReviewPatches([activePatch.patchId], "rejected")}
              >
                <X size={12} aria-hidden="true" />
                <span>Reject File</span>
              </button>
            </div>
          </div>

          {(activePatch.validation.stale ||
            activePatch.validation.errors.length > 0 ||
            activePatch.validation.warnings.length > 0) && (
            <div className={styles.card} data-testid="patch-validation-notices">
              {activePatch.validation.stale && (
                <p className={styles.muted}>
                  <AlertTriangle size={12} aria-hidden="true" /> File changed on disk since patch
                  generation. Re-generate before applying.
                </p>
              )}
              {activePatch.validation.errors.map((err, i) => (
                <p key={`err-${i}`} className={styles.muted}>
                  Error: {err}
                </p>
              ))}
              {activePatch.validation.warnings.map((warn, i) => (
                <p key={`warn-${i}`} className={styles.muted}>
                  Warning: {warn}
                </p>
              ))}
            </div>
          )}

          <div className={styles.monacoContainer} data-testid="monaco-diff-container">
            <DiffEditor
              height="360px"
              language={activePatch.language}
              original={activePatch.originalContent}
              modified={activePatch.proposedContent}
              theme={theme === "dark" ? "codemind-dark" : "codemind-light"}
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
