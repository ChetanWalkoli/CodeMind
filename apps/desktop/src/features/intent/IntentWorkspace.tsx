import { useState } from "react";
import {
  CheckCircle2,
  FileCheck2,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  X
} from "lucide-react";
import type { PatchApprovalEntry } from "@codemind/shared";
import { useDecisionStore } from "../../stores/decision.store";
import { useIntentStore, type IntentWorkspaceTab } from "../../stores/intent.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./IntentMode.module.scss";
import { PatchDiffReviewer } from "./PatchDiffReviewer";

const TABS: Array<{ id: IntentWorkspaceTab; label: string }> = [
  { id: "intent", label: "1. Intent" },
  { id: "investigate", label: "2. Investigation" },
  { id: "findings", label: "3. Findings" },
  { id: "recommendations", label: "4. Recommendations" },
  { id: "diff", label: "5. Diff Review" },
  { id: "apply", label: "6. Approve & Apply" },
  { id: "verify", label: "7. Verify" },
  { id: "recovery", label: "8. Rollback" }
];

export function IntentWorkspace() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);
  const setActiveNav = useWorkspaceStore((s) => s.setActiveNav);
  const createDecisionFromIntent = useDecisionStore((s) => s.createFromIntent);

  const session = useIntentStore((s) => s.activeSession);
  const activeTab = useIntentStore((s) => s.activeTab);
  const selectedPatchId = useIntentStore((s) => s.selectedPatchId);
  const verificationCommands = useIntentStore((s) => s.verificationCommands);
  const rollbackCheck = useIntentStore((s) => s.rollbackCheck);
  const busy = useIntentStore((s) => s.busy);
  const busyLabel = useIntentStore((s) => s.busyLabel);
  const error = useIntentStore((s) => s.error);

  const setActiveTab = useIntentStore((s) => s.setActiveTab);
  const setSelectedPatchId = useIntentStore((s) => s.setSelectedPatchId);
  const clearError = useIntentStore((s) => s.clearError);
  const clarifyIntent = useIntentStore((s) => s.clarifyIntent);
  const investigate = useIntentStore((s) => s.investigate);
  const analyze = useIntentStore((s) => s.analyze);
  const recommend = useIntentStore((s) => s.recommend);
  const decideRecommendation = useIntentStore((s) => s.decideRecommendation);
  const generatePatch = useIntentStore((s) => s.generatePatch);
  const reviewPatches = useIntentStore((s) => s.reviewPatches);
  const approveAndGetRecord = useIntentStore((s) => s.approveAndGetRecord);
  const applyTransaction = useIntentStore((s) => s.applyTransaction);
  const discoverVerification = useIntentStore((s) => s.discoverVerification);
  const runVerification = useIntentStore((s) => s.runVerification);
  const checkRollback = useIntentStore((s) => s.checkRollback);
  const executeRollback = useIntentStore((s) => s.executeRollback);

  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string>>({});
  const [latestApprovalId, setLatestApprovalId] = useState<string | null>(null);
  const [forceOverwrite, setForceOverwrite] = useState(false);

  if (!workspace || !session) {
    return (
      <div className={styles.workspace} data-testid="intent-workspace-empty">
        <div className={styles.emptyState}>
          <Sparkles size={22} aria-hidden="true" />
          <h3 className={styles.cardTitle}>CodeMind Intent Mode</h3>
          <p className={styles.muted}>
            Create or select an engineering intent in the left sidebar to investigate your codebase,
            review evidence-backed recommendations, inspect diffs in Monaco, apply approved patches,
            verify locally, and roll back safely.
          </p>
        </div>
      </div>
    );
  }

  const root = workspace.rootPath;
  const intent = session.intent;
  const acceptedPatches = session.patches.filter(
    (p) => p.reviewDecision === "accepted" && p.validation.valid && !p.validation.stale
  );
  const approvedRecIds = session.recommendations
    .filter((r) => r.decision === "approved_for_patch" || r.decision === "selected")
    .map((r) => r.recommendationId);

  const latestTx = session.transactions[session.transactions.length - 1] ?? null;

  const handleRegisterApproval = async () => {
    const entries: PatchApprovalEntry[] = acceptedPatches.map((p) => ({
      patchId: p.patchId,
      targetFile: p.targetFile,
      originalFileHash: p.originalFileHash,
      proposedFileHash: p.proposedFileHash,
      originalContentVersion: p.originalContentVersion
    }));
    const id = await approveAndGetRecord(root, intent.intentId, entries);
    if (id) setLatestApprovalId(id);
  };

  return (
    <div className={styles.workspace} data-testid="intent-workspace">
      <div className={styles.headerBar}>
        <div className={styles.headerTitle}>
          <h2>{intent.normalizedGoal}</h2>
          <div className={styles.sessionMeta}>
            <span className={styles.badge}>{intent.intentType}</span>
            <span className={styles.badge}>{intent.status}</span>
            <span className={styles.badge}>confidence: {intent.confidence}</span>
            {busyLabel && <span className={styles.badge}>{busyLabel}</span>}
          </div>
        </div>
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={busy}
            onClick={() => {
              void createDecisionFromIntent(root, intent.intentId).then((created) => {
                if (created) {
                  setActiveNav("decisions");
                  setCenterView("decisions");
                }
              });
            }}
          >
            Capture Decision
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => setCenterView("editor")}
          >
            Back to Editor
          </button>
        </div>
      </div>

      <div className={styles.tabBar} role="tablist" aria-label="Intent Mode stages">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert" data-testid="intent-error-banner">
          <span>{error}</span>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={clearError}
            aria-label="Dismiss error"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={styles.contentArea}>
        {/* STAGE 1: INTENT & CLARIFICATION */}
        {activeTab === "intent" && (
          <>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>Structured Intent Specification</h3>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={busy || intent.ambiguity.isAmbiguous}
                  onClick={() => void investigate(root, intent.intentId)}
                >
                  <Search size={12} aria-hidden="true" />
                  <span>Run Codebase Investigation</span>
                </button>
              </div>
              <p className={styles.muted}>Original prompt: {intent.originalPrompt}</p>
              {intent.affectedAreas.length > 0 && (
                <div className={styles.rowActions}>
                  <span className={styles.muted}>Affected areas:</span>
                  {intent.affectedAreas.map((area) => (
                    <span key={area} className={styles.badge}>
                      {area}
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.sectionTitle}>Acceptance Criteria</div>
              {intent.acceptanceCriteria.map((c) => (
                <div key={c.id} className={styles.rowActions}>
                  <span className={styles.badge}>{c.source}</span>
                  <span className={styles.muted}>{c.description}</span>
                </div>
              ))}
            </div>

            {intent.ambiguity.isAmbiguous && (
              <div className={styles.card} data-testid="intent-clarification-card">
                <h3 className={styles.cardTitle}>Clarification Required Before Investigation</h3>
                {intent.ambiguity.reasons.map((reason, idx) => (
                  <p key={idx} className={styles.muted}>
                    {reason}
                  </p>
                ))}
                {intent.clarificationQuestions.map((q) => (
                  <div key={q.id} className={styles.form}>
                    <label htmlFor={`clarify-${q.id}`} className={styles.cardTitle}>
                      {q.question}
                    </label>
                    <p className={styles.muted}>{q.reason}</p>
                    {q.suggestedOptions.length > 0 && (
                      <div className={styles.rowActions}>
                        {q.suggestedOptions.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            className={styles.secondaryBtn}
                            onClick={() =>
                              setClarificationAnswers((prev) => ({ ...prev, [q.id]: opt }))
                            }
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                    <input
                      id={`clarify-${q.id}`}
                      type="text"
                      className={styles.input}
                      placeholder="Enter clarification..."
                      value={clarificationAnswers[q.id] ?? q.answer ?? ""}
                      onChange={(e) =>
                        setClarificationAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={busy}
                  onClick={() => void clarifyIntent(root, intent.intentId, clarificationAnswers)}
                >
                  Submit Clarifications
                </button>
              </div>
            )}
          </>
        )}

        {/* STAGE 2: INVESTIGATION */}
        {activeTab === "investigate" && (
          <div className={styles.card} data-testid="intent-investigation-panel">
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>Codebase Investigation Report</h3>
              <div className={styles.rowActions}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  disabled={busy || intent.ambiguity.isAmbiguous}
                  onClick={() => void investigate(root, intent.intentId)}
                >
                  Re-run Investigation
                </button>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={busy || !session.investigation}
                  onClick={() => void analyze(root, intent.intentId)}
                >
                  Run Evidence Analysis
                </button>
              </div>
            </div>

            {!session.investigation ? (
              <p className={styles.muted}>
                No investigation run yet. Click &ldquo;Re-run Investigation&rdquo; to scan indexed
                files, dependencies, and API links.
              </p>
            ) : (
              <>
                <div className={styles.rowActions}>
                  <span className={styles.badge}>
                    {session.investigation.relevantFiles.length} files
                  </span>
                  <span className={styles.badge}>
                    {session.investigation.relevantSymbols.length} symbols
                  </span>
                  <span className={styles.badge}>
                    {session.investigation.apiRelationships.length} API links
                  </span>
                  <span className={styles.badge}>
                    {session.investigation.testFiles.length} test files
                  </span>
                  <span className={styles.badge}>{session.investigation.durationMs}ms</span>
                </div>
                {session.investigation.relevantFiles.map((f) => (
                  <div key={f.filePath} className={styles.rowActions}>
                    <strong>{f.filePath}</strong>
                    <span className={styles.badge}>{f.role}</span>
                    <span className={styles.muted}>{f.reasons.join(", ")}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* STAGE 3: EVIDENCE-BASED FINDINGS */}
        {activeTab === "findings" && (
          <div className={styles.card} data-testid="intent-findings-panel">
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>Evidence-Based Analysis Findings</h3>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={busy || !session.analysis}
                onClick={() => void recommend(root, intent.intentId)}
              >
                Generate Recommendations
              </button>
            </div>

            {!session.analysis ? (
              <p className={styles.muted}>Run investigation and analysis to inspect findings.</p>
            ) : (
              <>
                <p className={styles.muted}>{session.analysis.summary}</p>
                {session.analysis.findings.map((finding) => (
                  <div key={finding.findingId} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <strong>{finding.title}</strong>
                      <div className={styles.rowActions}>
                        <span className={styles.badge}>{finding.verificationStatus}</span>
                        <span className={styles.badge}>{finding.severity}</span>
                      </div>
                    </div>
                    <p className={styles.muted}>{finding.description}</p>
                    <div className={styles.rowActions}>
                      {finding.evidenceReferences.map((ref) => (
                        <span key={ref.evidenceId} className={styles.badge}>
                          {ref.filePath}:{ref.startLine}-{ref.endLine}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* STAGE 4: RECOMMENDATIONS */}
        {activeTab === "recommendations" && (
          <div className={styles.card} data-testid="intent-recommendations-panel">
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>
                Ranked Recommendations ({session.recommendations.length})
              </h3>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={busy || approvedRecIds.length === 0}
                onClick={() => void generatePatch(root, intent.intentId, approvedRecIds, true)}
              >
                Generate Patches ({approvedRecIds.length} selected)
              </button>
            </div>
            <p className={styles.muted}>
              Approving a recommendation authorizes patch proposal generation only — it does NOT
              modify workspace files.
            </p>
            {session.recommendations.map((rec) => (
              <div key={rec.recommendationId} className={styles.card}>
                <div className={styles.cardHeader}>
                  <strong>{rec.title}</strong>
                  <div className={styles.rowActions}>
                    <span className={styles.badge}>{rec.priority.toUpperCase()}</span>
                    <span className={styles.badge}>score {rec.rankScore}</span>
                    <span className={styles.badge}>{rec.decision}</span>
                  </div>
                </div>
                <p className={styles.muted}>{rec.description}</p>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.successBtn}
                    onClick={() =>
                      void decideRecommendation(
                        root,
                        intent.intentId,
                        rec.recommendationId,
                        "approved_for_patch"
                      )
                    }
                  >
                    Approve for Patch
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() =>
                      void decideRecommendation(
                        root,
                        intent.intentId,
                        rec.recommendationId,
                        "deferred"
                      )
                    }
                  >
                    Defer
                  </button>
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    onClick={() =>
                      void decideRecommendation(
                        root,
                        intent.intentId,
                        rec.recommendationId,
                        "rejected"
                      )
                    }
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* STAGE 5: MONACO DIFF REVIEW */}
        {activeTab === "diff" && (
          <PatchDiffReviewer
            patches={session.patches}
            selectedPatchId={selectedPatchId}
            busy={busy}
            onSelectPatch={setSelectedPatchId}
            onReviewPatches={(ids, decision) =>
              void reviewPatches(root, intent.intentId, ids, decision)
            }
            onProceedToApply={() => setActiveTab("apply")}
          />
        )}

        {/* STAGE 6: EXPLICIT APPROVAL & SAFE APPLICATION */}
        {activeTab === "apply" && (
          <div className={styles.card} data-testid="intent-apply-panel">
            <h3 className={styles.cardTitle}>
              Explicit Transaction Approval &amp; Safe Application
            </h3>
            <p className={styles.muted}>
              Every target file is revalidated against WorkspaceAuthority, symlink containment,
              secret rules, and exact SHA-256 original file hashes immediately before writing.
            </p>
            {acceptedPatches.length === 0 ? (
              <p className={styles.muted}>
                No valid accepted patches ready. Accept files in Diff Review first.
              </p>
            ) : (
              <>
                {acceptedPatches.map((p) => (
                  <div key={p.patchId} className={styles.rowActions}>
                    <FileCheck2 size={13} aria-hidden="true" />
                    <strong>{p.targetFile}</strong>
                    <span className={styles.badge}>
                      +{p.addedLines}/-{p.removedLines}
                    </span>
                    <span className={styles.muted}>orig {p.originalFileHash.slice(0, 10)}</span>
                  </div>
                ))}
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={busy}
                    onClick={() => void handleRegisterApproval()}
                  >
                    <ShieldCheck size={12} aria-hidden="true" />
                    <span>1. Confirm Explicit Transaction Approval</span>
                  </button>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={busy || !latestApprovalId}
                    onClick={() => {
                      if (latestApprovalId) {
                        void applyTransaction(root, intent.intentId, latestApprovalId);
                      }
                    }}
                  >
                    <Play size={12} aria-hidden="true" />
                    <span>2. Apply Approved Transaction</span>
                  </button>
                </div>
              </>
            )}

            {session.transactions.length > 0 && (
              <>
                <div className={styles.sectionTitle}>Applied Transactions</div>
                {session.transactions.map((tx) => (
                  <div key={tx.transactionId} className={styles.rowActions}>
                    <CheckCircle2 size={12} aria-hidden="true" />
                    <code>{tx.transactionId}</code>
                    <span className={styles.badge}>{tx.status}</span>
                    <span className={styles.muted}>{tx.files.length} file(s)</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* STAGE 7: LOCAL VERIFICATION ENGINE */}
        {activeTab === "verify" && (
          <div className={styles.card} data-testid="intent-verify-panel">
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>Local Verification Engine</h3>
              <button
                type="button"
                className={styles.secondaryBtn}
                disabled={busy}
                onClick={() => void discoverVerification(root, intent.intentId)}
              >
                <Terminal size={12} aria-hidden="true" />
                <span>Discover Project Commands</span>
              </button>
            </div>
            <p className={styles.muted}>
              Commands are discovered from package.json and never executed automatically. Approve
              each command explicitly before running.
            </p>

            {verificationCommands.map((cmd) => (
              <div key={cmd.commandId} className={styles.cardHeader}>
                <div>
                  <strong>{cmd.label}</strong>
                  <p className={styles.muted}>
                    <code>{cmd.displayCommand}</code> ({cmd.scriptSource})
                  </p>
                </div>
                {cmd.safe ? (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={busy}
                    onClick={() =>
                      void runVerification(
                        root,
                        intent.intentId,
                        cmd.commandId,
                        latestTx?.transactionId
                      )
                    }
                  >
                    Approve &amp; Run
                  </button>
                ) : (
                  <span className={`${styles.badge} ${styles.badgeError}`}>
                    Blocked: {cmd.blockedReason}
                  </span>
                )}
              </div>
            ))}

            {session.verifications.map((run) => (
              <div key={run.verificationId} className={styles.card}>
                <div className={styles.cardHeader}>
                  <strong>{run.displayCommand}</strong>
                  <div className={styles.rowActions}>
                    <span
                      className={`${styles.badge} ${
                        run.status === "passed" ? styles.badgeSuccess : styles.badgeError
                      }`}
                    >
                      {run.status} (exit {run.exitCode ?? "n/a"})
                    </span>
                    <span className={styles.badge}>{run.durationMs}ms</span>
                  </div>
                </div>
                {(run.stdout || run.stderr) && (
                  <pre className={styles.preOutput}>{run.stdout || run.stderr}</pre>
                )}
              </div>
            ))}
          </div>
        )}

        {/* STAGE 8: ROLLBACK & RECOVERY */}
        {activeTab === "recovery" && (
          <div className={styles.card} data-testid="intent-recovery-panel">
            <h3 className={styles.cardTitle}>Rollback &amp; Recovery Manager</h3>
            {session.transactions.length === 0 ? (
              <p className={styles.muted}>No applied patch transactions to roll back.</p>
            ) : (
              session.transactions.map((tx) => (
                <div key={tx.transactionId} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <strong>Transaction {tx.transactionId}</strong>
                    <span className={styles.badge}>{tx.status}</span>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      disabled={busy}
                      onClick={() => void checkRollback(root, intent.intentId, tx.transactionId)}
                    >
                      Check Conflicts &amp; Backup Integrity
                    </button>
                    <button
                      type="button"
                      className={styles.dangerBtn}
                      disabled={busy}
                      onClick={() =>
                        void executeRollback(
                          root,
                          intent.intentId,
                          tx.transactionId,
                          "full-transaction",
                          undefined,
                          forceOverwrite
                        )
                      }
                    >
                      <RotateCcw size={12} aria-hidden="true" />
                      <span>Confirm Full Rollback</span>
                    </button>
                  </div>
                </div>
              ))
            )}

            {rollbackCheck && (
              <div className={styles.card} data-testid="intent-rollback-check">
                <div className={styles.rowActions}>
                  <ShieldAlert size={13} aria-hidden="true" />
                  <strong>
                    {rollbackCheck.canRollbackCleanly
                      ? "Clean rollback available (no post-patch conflicts)."
                      : `${rollbackCheck.conflicts.length} conflict(s) detected.`}
                  </strong>
                </div>
                {rollbackCheck.conflicts.map((c, idx) => (
                  <p key={idx} className={styles.muted}>
                    {c.targetFile}: {c.message}
                  </p>
                ))}
                {!rollbackCheck.canRollbackCleanly && (
                  <label className={styles.rowActions}>
                    <input
                      type="checkbox"
                      checked={forceOverwrite}
                      onChange={(e) => setForceOverwrite(e.target.checked)}
                    />
                    <span className={styles.muted}>
                      Explicitly overwrite files modified after patch application
                    </span>
                  </label>
                )}
              </div>
            )}

            {session.rollbacks.length > 0 && (
              <>
                <div className={styles.sectionTitle}>Rollback History</div>
                {session.rollbacks.map((rb) => (
                  <div key={rb.rollbackId} className={styles.rowActions}>
                    <code>{rb.rollbackId}</code>
                    <span className={styles.badge}>{rb.mode}</span>
                    <span className={styles.badge}>{rb.status}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
