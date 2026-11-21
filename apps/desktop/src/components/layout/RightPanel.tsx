import { Sparkles, X } from "lucide-react";
import { ContextPreviewPanel } from "../../features/ai/ContextPreviewPanel";
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

      <div className={styles.content}>
        <ContextPreviewPanel />
      </div>
    </aside>
  );
}
