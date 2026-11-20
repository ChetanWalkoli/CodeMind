import { useEditorStore } from "../../stores/editor.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./StatusBar.module.scss";

export function StatusBar() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const cursor = useEditorStore((s) => s.cursor);
  const tabSize = useEditorStore((s) => s.settings.tabSize);

  const isElectron = useWorkspaceStore((s) => s.isElectron);
  const bridgeStatus = useWorkspaceStore((s) => s.bridgeStatus);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const readinessLabel =
    bridgeStatus === "ready"
      ? isElectron
        ? "Desktop Ready"
        : "Browser Preview Ready"
      : bridgeStatus === "initializing"
        ? "Initializing..."
        : "Bridge Degraded";

  return (
    <footer className={styles.statusBar} aria-label="Editor status bar">
      <div className={styles.group}>
        <span className={styles.item} data-testid="status-readiness">
          <span
            className={`${styles.statusDot} ${bridgeStatus !== "ready" ? styles.statusDotWarn : ""}`}
            aria-hidden="true"
          />
          {readinessLabel}
        </span>

        <span className={styles.item} data-testid="status-file">
          {activeTab
            ? `${activeTab.title}${activeTab.isDirty ? " (Modified)" : ""}`
            : "No file open"}
        </span>
      </div>

      <div className={styles.group}>
        {activeTab && (
          <>
            <span className={styles.item} data-testid="status-cursor">
              Ln {cursor.line}, Col {cursor.column}
            </span>
            <span className={styles.item}>Spaces: {tabSize}</span>
            <span className={styles.item}>UTF-8</span>
            <span className={styles.item} data-testid="status-language">
              {activeTab.languageLabel}
            </span>
          </>
        )}
        {!activeTab && <span className={styles.item}>UTF-8</span>}
      </div>
    </footer>
  );
}
