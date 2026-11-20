import { X } from "lucide-react";
import { useLayoutStore } from "../../stores/layout.store";
import { useWorkspaceStore, type BottomPanelTabId } from "../../stores/workspace.store";
import styles from "./BottomPanel.module.scss";

const PANEL_TABS: { id: BottomPanelTabId; label: string; emptyMessage: string }[] = [
  {
    id: "problems",
    label: "Problems",
    emptyMessage: "No problems have been detected in the current editor buffers."
  },
  {
    id: "output",
    label: "Output",
    emptyMessage:
      "No build or verification output yet. Verification runners arrive in a later phase."
  },
  {
    id: "terminal",
    label: "Terminal",
    emptyMessage:
      "Integrated terminal execution is intentionally disabled in Phase 1. Permitted command execution will be introduced with explicit approval controls in a later phase."
  }
];

export function BottomPanel() {
  const bottomPanelVisible = useLayoutStore((s) => s.bottomPanelVisible);
  const bottomPanelHeight = useLayoutStore((s) => s.bottomPanelHeight);
  const toggleBottomPanel = useLayoutStore((s) => s.toggleBottomPanel);

  const activeBottomTab = useWorkspaceStore((s) => s.activeBottomTab);
  const setActiveBottomTab = useWorkspaceStore((s) => s.setActiveBottomTab);

  if (!bottomPanelVisible) {
    return null;
  }

  const current = PANEL_TABS.find((tab) => tab.id === activeBottomTab) ?? PANEL_TABS[0]!;

  return (
    <section
      className={styles.bottomPanel}
      style={{ height: `${bottomPanelHeight}px` }}
      aria-label="Bottom diagnostic panel"
      data-testid="workbench-bottom-panel"
    >
      <div className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label="Bottom panel tabs">
          {PANEL_TABS.map((tab) => {
            const isActive = tab.id === activeBottomTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`${styles.tabBtn} ${isActive ? styles.tabBtnActive : ""}`}
                onClick={() => setActiveBottomTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={styles.closeBtn}
          onClick={toggleBottomPanel}
          aria-label="Collapse bottom panel"
          title="Collapse Bottom Panel"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.content} role="tabpanel">
        {current.emptyMessage}
      </div>
    </section>
  );
}
