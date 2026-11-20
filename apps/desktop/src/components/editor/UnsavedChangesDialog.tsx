import { useEditorStore } from "../../stores/editor.store";
import styles from "./UnsavedChangesDialog.module.scss";

export function UnsavedChangesDialog() {
  const pendingCloseTabId = useEditorStore((s) => s.pendingCloseTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const cancelPendingClose = useEditorStore((s) => s.cancelPendingClose);
  const confirmPendingClose = useEditorStore((s) => s.confirmPendingClose);

  if (!pendingCloseTabId) {
    return null;
  }

  const targetTab = tabs.find((t) => t.id === pendingCloseTabId);
  if (!targetTab) {
    return null;
  }

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-title"
    >
      <div className={styles.dialog}>
        <h2 id="unsaved-title" className={styles.title}>
          Discard unsaved changes?
        </h2>
        <p className={styles.message}>
          <strong>{targetTab.title}</strong> has unsaved in-memory edits. Closing this tab will
          discard those changes.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={cancelPendingClose}>
            Keep Editing
          </button>
          <button type="button" className={styles.discardBtn} onClick={confirmPendingClose}>
            Discard &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
}
