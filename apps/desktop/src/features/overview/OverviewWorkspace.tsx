import { useEffect } from "react";
import {
  navigateToDecisionRecord,
  navigateToImpactRecord
} from "../../services/evidenceNavigation";
import { useActivityStore } from "../../stores/activity.store";
import { useDecisionStore } from "../../stores/decision.store";
import { useImpactStore } from "../../stores/impact.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./Overview.module.scss";

interface OverviewWorkspaceProps {
  onOpenOnboarding?: () => void;
}

export function OverviewWorkspace({ onOpenOnboarding }: OverviewWorkspaceProps) {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const indexSummary = useWorkspaceStore((s) => s.indexSummary);
  const isIndexing = useWorkspaceStore((s) => s.isIndexing);
  const gitStatus = useWorkspaceStore((s) => s.gitStatus);
  const openFolderDialog = useWorkspaceStore((s) => s.openFolderDialog);
  const refreshIndex = useWorkspaceStore((s) => s.refreshIndex);
  const setActiveNav = useWorkspaceStore((s) => s.setActiveNav);

  const decisions = useDecisionStore((s) => s.decisions);
  const loadDecisions = useDecisionStore((s) => s.loadAll);

  const impactSummaries = useImpactStore((s) => s.summaries);
  const loadImpactSummaries = useImpactStore((s) => s.loadSummaries);

  const activityEvents = useActivityStore((s) => s.events);
  const loadActivity = useActivityStore((s) => s.loadActivity);

  useEffect(() => {
    if (!workspace?.rootPath) return;
    void loadDecisions(workspace.rootPath);
    void loadImpactSummaries(workspace.rootPath);
    void loadActivity(workspace.rootPath);
  }, [workspace?.rootPath, loadDecisions, loadImpactSummaries, loadActivity]);

  if (!workspace) {
    return (
      <div className={styles.overview} data-testid="overview-workspace-empty">
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>CodeMind</h1>
            <p className={styles.subtitle}>Understand. Improve. Remember. Predict.</p>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => void openFolderDialog()}
            >
              Open Project Folder
            </button>
            {onOpenOnboarding && (
              <button type="button" className={styles.secondaryBtn} onClick={onOpenOnboarding}>
                Getting Started Guide
              </button>
            )}
          </div>
        </div>

        <p className={styles.muted}>
          No workspace is open yet. Open a local project folder to index your codebase locally,
          explore architecture graphs, run Intent Mode improvements, record Decision Memory, and
          predict Change Impact.
        </p>

        <div className={styles.pillarsGrid}>
          <div className={styles.pillarCard}>
            <span className={styles.pillarTag}>1. Understand</span>
            <span className={styles.pillarTitle}>Explain My Codebase</span>
            <p className={styles.pillarDesc}>
              Local AST indexing, dependency graphs, and evidence-grounded explanations.
            </p>
          </div>
          <div className={styles.pillarCard}>
            <span className={styles.pillarTag}>2. Improve</span>
            <span className={styles.pillarTitle}>Intent Mode</span>
            <p className={styles.pillarDesc}>
              Evidence-backed recommendations, reviewed diffs, atomic patches, and verification.
            </p>
          </div>
          <div className={styles.pillarCard}>
            <span className={styles.pillarTag}>3. Remember</span>
            <span className={styles.pillarTitle}>Decision Memory</span>
            <p className={styles.pillarDesc}>
              Structured engineering decisions linked to code evidence, commits, and tradeoffs.
            </p>
          </div>
          <div className={styles.pillarCard}>
            <span className={styles.pillarTag}>4. Predict</span>
            <span className={styles.pillarTitle}>Change Impact Intelligence</span>
            <p className={styles.pillarDesc}>
              Dependency blast radius, API/DB contracts, affected tests, risk score, and validation.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overview} data-testid="overview-workspace">
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{workspace.name}</h1>
          <p className={styles.subtitle}>{workspace.rootPath}</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void refreshIndex(true)}
            disabled={isIndexing}
          >
            {isIndexing ? "Indexing..." : "Re-index Workspace"}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => void openFolderDialog()}
          >
            Switch Workspace
          </button>
          {onOpenOnboarding && (
            <button type="button" className={styles.secondaryBtn} onClick={onOpenOnboarding}>
              Guide
            </button>
          )}
        </div>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Indexed Files</span>
          <span className={styles.statValue}>{indexSummary ? indexSummary.indexedFiles : "—"}</span>
          <span className={styles.statMeta}>
            {isIndexing
              ? "Indexing in progress..."
              : indexSummary
                ? `${indexSummary.totalSymbols} symbols · ${indexSummary.totalEdges} edges`
                : "Not indexed yet"}
          </span>
        </div>

        <div className={styles.statCard}>
          <span className={styles.statLabel}>Git Status</span>
          <span className={styles.statValue}>
            {gitStatus?.isGitRepo ? (gitStatus.branch ?? "detached") : "No Git"}
          </span>
          <span className={styles.statMeta}>
            {gitStatus?.isGitRepo
              ? `${gitStatus.modifiedCount} working-tree change(s)${gitStatus.isDirty ? " (dirty)" : " (clean)"}`
              : "Git metadata unavailable"}
          </span>
        </div>

        <div className={styles.statCard}>
          <span className={styles.statLabel}>Engineering Decisions</span>
          <span className={styles.statValue}>{decisions.length}</span>
          <span className={styles.statMeta}>Local workspace Decision Memory</span>
        </div>

        <div className={styles.statCard}>
          <span className={styles.statLabel}>Impact Analyses</span>
          <span className={styles.statValue}>{impactSummaries.length}</span>
          <span className={styles.statMeta}>Saved Change Impact reports</span>
        </div>
      </div>

      <div className={styles.pillarsGrid}>
        <button type="button" className={styles.pillarCard} onClick={() => setActiveNav("graph")}>
          <span className={styles.pillarTag}>1. Understand</span>
          <span className={styles.pillarTitle}>Explore Architecture</span>
          <p className={styles.pillarDesc}>Inspect dependency graphs, modules, and symbols.</p>
        </button>

        <button type="button" className={styles.pillarCard} onClick={() => setActiveNav("intent")}>
          <span className={styles.pillarTag}>2. Improve</span>
          <span className={styles.pillarTitle}>Intent Mode</span>
          <p className={styles.pillarDesc}>Investigate issues and safely apply reviewed patches.</p>
        </button>

        <button
          type="button"
          className={styles.pillarCard}
          onClick={() => setActiveNav("decisions")}
        >
          <span className={styles.pillarTag}>3. Remember</span>
          <span className={styles.pillarTitle}>Decision Memory</span>
          <p className={styles.pillarDesc}>Record why code was built this way with evidence.</p>
        </button>

        <button type="button" className={styles.pillarCard} onClick={() => setActiveNav("impact")}>
          <span className={styles.pillarTag}>4. Predict</span>
          <span className={styles.pillarTitle}>Change Impact</span>
          <p className={styles.pillarDesc}>Predict risk, contracts, tests, and validation steps.</p>
        </button>
      </div>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Recent Activity</h3>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => setActiveNav("activity")}
            >
              View All
            </button>
          </div>
          {activityEvents.length === 0 ? (
            <p className={styles.muted}>No activity recorded for this workspace yet.</p>
          ) : (
            activityEvents.slice(0, 5).map((ev) => (
              <div key={ev.id} className={styles.listItem}>
                <span className={styles.itemTitle}>{ev.summary}</span>
                <span className={styles.itemMeta}>
                  {ev.feature} · {new Date(ev.timestamp).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Recent Decisions</h3>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => setActiveNav("decisions")}
            >
              Open Decisions
            </button>
          </div>
          {decisions.length === 0 ? (
            <p className={styles.muted}>No decisions recorded yet.</p>
          ) : (
            decisions.slice(0, 5).map((dec) => (
              <button
                key={dec.id}
                type="button"
                className={styles.listItem}
                onClick={() => void navigateToDecisionRecord(workspace.rootPath, dec.id)}
              >
                <span className={styles.itemTitle}>{dec.title}</span>
                <span className={styles.itemMeta}>
                  {dec.category} · {dec.status} · {dec.verificationStatus}
                </span>
              </button>
            ))
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Recent Impact Analyses</h3>
            <button type="button" className={styles.linkBtn} onClick={() => setActiveNav("impact")}>
              Open Impact
            </button>
          </div>
          {impactSummaries.length === 0 ? (
            <p className={styles.muted}>No impact analyses saved yet.</p>
          ) : (
            impactSummaries.slice(0, 5).map((imp) => (
              <button
                key={imp.analysisId}
                type="button"
                className={styles.listItem}
                onClick={() => void navigateToImpactRecord(workspace.rootPath, imp.analysisId)}
              >
                <span className={styles.itemTitle}>{imp.targetFiles[0] ?? imp.analysisId}</span>
                <span className={styles.itemMeta}>
                  {imp.riskLevel.toUpperCase()} ({imp.riskScore}/100) · {imp.impactedFileCount}{" "}
                  files
                </span>
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
