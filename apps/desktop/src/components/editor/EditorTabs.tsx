import { FileCode2, Plus, X } from "lucide-react";
import { useEditorStore } from "../../stores/editor.store";
import styles from "./EditorTabs.module.scss";

export function EditorTabs() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const requestCloseTab = useEditorStore((s) => s.requestCloseTab);
  const createScratchTab = useEditorStore((s) => s.createScratchTab);

  return (
    <div className={styles.tabBar} role="tablist" aria-label="Open editor tabs">
      <div className={styles.tabList}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveTab(tab.id);
                }
              }}
              title={`${tab.title} (${tab.isInMemory ? "In-memory buffer" : "Disk"})`}
            >
              <FileCode2 size={13} aria-hidden="true" />
              <span className={styles.tabTitle}>{tab.title}</span>
              {tab.isDirty && (
                <span
                  className={styles.dirtyDot}
                  aria-label="Unsaved changes"
                  title="Unsaved changes"
                />
              )}
              <button
                type="button"
                className={styles.closeButton}
                aria-label={`Close ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  requestCloseTab(tab.id);
                }}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={styles.newTabButton}
        onClick={() => createScratchTab(".ts")}
        aria-label="New scratch buffer"
        title="New in-memory scratch buffer"
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
