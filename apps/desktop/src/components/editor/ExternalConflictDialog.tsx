import { useEditorStore } from "../../stores/editor.store";
import styles from "./UnsavedChangesDialog.module.scss";

export function ExternalConflictDialog() {
  const conflictTabId = useEditorStore((s) => s.conflictTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const reloadTabFromDisk = useEditorStore((s) => s.reloadTabFromDisk);
  const saveTab = useEditorStore((s) => s.saveTab);
  const dismissConflict = useEditorStore((s) => s.dismissConflict);

  if (!conflictTabId) {
    return null;
  }

  const targetTab = tabs.find((t) => t.id === conflictTabId);
  if (!targetTab) {
    return null;
  }

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="external-conflict-title"
    >
      <div className={styles.dialog}>
        <h2 id="external-conflict-title" className={styles.title}>
          File changed on disk
        </h2>
        <p className={styles.message}>
          <strong>{targetTab.relativePath ?? targetTab.title}</strong> was modified outside CodeMind
          since you opened it. Choose whether to reload the latest version from disk or overwrite it
          with your editor changes.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => dismissConflict(targetTab.id)}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={() => void reloadTabFromDisk(targetTab.id)}
          >
            Reload from Disk
          </button>
          <button
            type="button"
            className={styles.discardBtn}
            onClick={() => void saveTab(targetTab.id, true)}
          >
            Overwrite Disk File
          </button>
        </div>
      </div>
    </div>
  );
}
