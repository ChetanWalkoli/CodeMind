import { FilePlus2, Map as MapIcon, WrapText } from "lucide-react";
import { useEditorStore } from "../../stores/editor.store";
import styles from "./WorkspaceToolbar.module.scss";

export function WorkspaceToolbar() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const settings = useEditorStore((s) => s.settings);
  const createScratchTab = useEditorStore((s) => s.createScratchTab);
  const toggleMinimap = useEditorStore((s) => s.toggleMinimap);
  const toggleWordWrap = useEditorStore((s) => s.toggleWordWrap);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Workspace toolbar">
      <div className={styles.breadcrumb}>
        <span className={styles.fileName}>{activeTab ? activeTab.title : "No file open"}</span>
        {activeTab?.isInMemory && <span className={styles.badge}>In-memory buffer</span>}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => createScratchTab(".ts")}
          title="Create new in-memory scratch buffer"
        >
          <FilePlus2 size={13} aria-hidden="true" />
          <span>New Buffer</span>
        </button>

        <button
          type="button"
          className={`${styles.toolBtn} ${settings.minimap ? styles.toolBtnActive : ""}`}
          onClick={toggleMinimap}
          aria-pressed={settings.minimap}
          title="Toggle editor minimap"
        >
          <MapIcon size={13} aria-hidden="true" />
          <span>Minimap</span>
        </button>

        <button
          type="button"
          className={`${styles.toolBtn} ${settings.wordWrap === "on" ? styles.toolBtnActive : ""}`}
          onClick={toggleWordWrap}
          aria-pressed={settings.wordWrap === "on"}
          title="Toggle word wrap"
        >
          <WrapText size={13} aria-hidden="true" />
          <span>Wrap</span>
        </button>
      </div>
    </div>
  );
}
