import { Sparkles, X } from "lucide-react";
import { useLayoutStore } from "../../stores/layout.store";
import styles from "./RightPanel.module.scss";

export function RightPanel() {
  const rightPanelVisible = useLayoutStore((s) => s.rightPanelVisible);
  const rightPanelWidth = useLayoutStore((s) => s.rightPanelWidth);
  const toggleRightPanel = useLayoutStore((s) => s.toggleRightPanel);

  if (!rightPanelVisible) {
    return null;
  }

  return (
    <aside
      className={styles.rightPanel}
      style={{ width: `${rightPanelWidth}px` }}
      aria-label="AI Intelligence Panel"
      data-testid="workbench-right-panel"
    >
      <div className={styles.header}>
        <span className={styles.titleGroup}>
          <Sparkles size={13} aria-hidden="true" />
          <span>AI Intelligence</span>
        </span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={toggleRightPanel}
          aria-label="Collapse right panel"
          title="Collapse AI panel"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.body}>
        <span className={styles.iconBadge} aria-hidden="true">
          <Sparkles size={18} />
        </span>
        <h3 className={styles.heading}>Codebase-Aware Assistant</h3>
        <p className={styles.description}>
          Project-grounded explanations, architectural Q&amp;A, and reviewed patch suggestions will
          be enabled in a later phase once local code indexing is active.
        </p>
      </div>
    </aside>
  );
}
