import { useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./Onboarding.module.scss";

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

export function OnboardingModal({ open, onClose }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const openFolderDialog = useWorkspaceStore((s) => s.openFolderDialog);
  const setActiveNav = useWorkspaceStore((s) => s.setActiveNav);

  if (!open) return null;

  const finish = async (targetNav: "overview" | "settings" = "overview") => {
    await desktopApi.updateAppPreferences({ onboardingCompleted: true });
    setActiveNav(targetNav);
    onClose();
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to CodeMind"
      data-testid="onboarding-modal"
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            {step === 0
              ? "Welcome to CodeMind"
              : step === 1
                ? "Local-First Workspace & Indexing"
                : "Optional Gemini AI & Explicit Consent"}
          </h2>
          <span className={styles.stepMeta}>Step {step + 1} of 3</span>
        </div>

        <div className={styles.body}>
          {step === 0 && (
            <>
              <p style={{ margin: 0 }}>
                <strong>Understand. Improve. Remember. Predict.</strong> CodeMind brings four
                local-first engineering pillars into one desktop workbench:
              </p>
              <ul className={styles.list}>
                <li>
                  <strong>Understand:</strong> Local AST indexing, dependency graphs, and codebase
                  explanations.
                </li>
                <li>
                  <strong>Improve:</strong> Evidence-backed Intent Mode recommendations, Monaco
                  diffs, and atomic patches.
                </li>
                <li>
                  <strong>Remember:</strong> Structured Decision Memory linked to files, commits,
                  and tradeoffs.
                </li>
                <li>
                  <strong>Predict:</strong> Change Impact blast radius, API/DB contracts, tests,
                  risk scores, and validation plans.
                </li>
              </ul>
            </>
          )}

          {step === 1 && (
            <>
              <p style={{ margin: 0 }}>
                All indexing, dependency graphs, Decision Memory, Change Impact, and Activity
                History run <strong>100% locally</strong> inside your authorized workspace boundary.
                Secret files (<code>.env</code>, keys, credentials) and ignored paths are
                automatically excluded.
              </p>
              <div>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void openFolderDialog()}
                >
                  {workspace
                    ? `Active: ${workspace.name} (Change Folder)`
                    : "Select Project Folder"}
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p style={{ margin: 0 }}>
                Google Gemini is <strong>optional</strong> — you can explore code intelligence,
                Decision Memory, and Change Impact completely offline.
              </p>
              <ul className={styles.list}>
                <li>API keys are encrypted using OS secure storage and never exposed to the UI.</li>
                <li>
                  Code is never sent to Gemini without your explicit context preview &amp; approval.
                </li>
                <li>Patches and verification commands never run automatically.</li>
              </ul>
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void finish("overview")}
          >
            Skip
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            {step > 0 && (
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => setStep((s) => s - 1)}
              >
                Back
              </button>
            )}
            {step < 2 ? (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => void finish("settings")}
                >
                  Configure Gemini
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={() => void finish("overview")}
                >
                  Finish
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
