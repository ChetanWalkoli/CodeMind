import { useEffect } from "react";
import { BookMarked, HelpCircle, Plus } from "lucide-react";
import { useDecisionStore } from "../../stores/decision.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./DecisionMemory.module.scss";

export function DecisionSidebarPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);

  const decisions = useDecisionStore((s) => s.decisions);
  const suggestions = useDecisionStore((s) => s.suggestions);
  const selectedDecisionId = useDecisionStore((s) => s.selectedDecisionId);
  const loadAll = useDecisionStore((s) => s.loadAll);
  const selectDecision = useDecisionStore((s) => s.selectDecision);
  const setActiveTab = useDecisionStore((s) => s.setActiveTab);
  const resetForWorkspace = useDecisionStore((s) => s.resetForWorkspace);

  useEffect(() => {
    if (!workspace) {
      resetForWorkspace();
      return;
    }
    void loadAll(workspace.rootPath);
  }, [workspace?.rootPath, loadAll, resetForWorkspace]);

  if (!workspace) {
    return (
      <div className={styles.emptyState} data-testid="decision-sidebar-empty">
        <BookMarked size={18} aria-hidden="true" />
        <p className={styles.muted}>Open a project folder to use Decision Memory.</p>
      </div>
    );
  }

  return (
    <div className={styles.sidebar} data-testid="decision-sidebar">
      <div className={styles.row}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => {
            setActiveTab("create");
            setCenterView("decisions");
          }}
        >
          <Plus size={12} aria-hidden="true" />
          <span>New Decision</span>
        </button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => {
            setActiveTab("ask_why");
            setCenterView("decisions");
          }}
        >
          <HelpCircle size={12} aria-hidden="true" />
          <span>Ask Why</span>
        </button>
      </div>

      {suggestions.length > 0 && (
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => {
            setActiveTab("suggestions");
            setCenterView("decisions");
          }}
        >
          <span>{suggestions.length} Suggested Decision(s)</span>
        </button>
      )}

      <p className={styles.muted}>Recorded Decisions ({decisions.length})</p>

      {decisions.length === 0 ? (
        <p className={styles.muted}>
          No decisions recorded yet. Click &ldquo;New Decision&rdquo; to document your first
          engineering decision.
        </p>
      ) : (
        <ul className={styles.list} data-testid="decision-sidebar-list">
          {decisions.map((d) => {
            const isSelected = selectedDecisionId === d.id;
            const isStale =
              d.verificationStatus === "stale" || d.verificationStatus === "partially_stale";
            return (
              <li key={d.id}>
                <button
                  type="button"
                  className={`${styles.listItem} ${isSelected ? styles.listItemActive : ""}`}
                  onClick={() => {
                    selectDecision(d.id);
                    setCenterView("decisions");
                  }}
                >
                  <strong>{d.title}</strong>
                  <div className={styles.row}>
                    <span className={styles.badge}>{d.category}</span>
                    <span className={styles.badge}>{d.status}</span>
                    {isStale && (
                      <span className={`${styles.badge} ${styles.badgeWarn}`}>
                        {d.verificationStatus}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
