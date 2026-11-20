import { Code2 } from "lucide-react";
import { SAMPLE_DOCUMENTS } from "../../data/sampleDocuments";
import { useEditorStore } from "../../stores/editor.store";
import styles from "./EmptyEditorState.module.scss";

export function EmptyEditorState() {
  const openTab = useEditorStore((s) => s.openTab);
  const createScratchTab = useEditorStore((s) => s.createScratchTab);

  return (
    <div className={styles.empty} data-testid="empty-editor-state">
      <Code2 size={28} className={styles.icon} aria-hidden="true" />
      <h2 className={styles.heading}>No editor open</h2>
      <p className={styles.subtext}>
        Open an in-memory scratch buffer to test the editor. Local project folder opening arrives in
        Phase 2.
      </p>
      <div className={styles.actions}>
        <button type="button" className={styles.primaryBtn} onClick={() => createScratchTab(".ts")}>
          New Scratch Buffer
        </button>
        {SAMPLE_DOCUMENTS[0] && (
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => openTab({ ...SAMPLE_DOCUMENTS[0]!, isInMemory: true })}
          >
            Open Sample (welcome.ts)
          </button>
        )}
      </div>
    </div>
  );
}
