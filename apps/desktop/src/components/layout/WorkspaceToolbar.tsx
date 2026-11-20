import { FilePlus2, FolderOpen, Map as MapIcon, Save, WrapText } from "lucide-react";
import { useEditorStore } from "../../stores/editor.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./WorkspaceToolbar.module.scss";

export function WorkspaceToolbar() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const settings = useEditorStore((s) => s.settings);
  const createScratchTab = useEditorStore((s) => s.createScratchTab);
  const saveActiveTab = useEditorStore((s) => s.saveActiveTab);
  const toggleMinimap = useEditorStore((s) => s.toggleMinimap);
  const toggleWordWrap = useEditorStore((s) => s.toggleWordWrap);

  const openFolderDialog = useWorkspaceStore((s) => s.openFolderDialog);
  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const canSave = Boolean(activeTab && !activeTab.isInMemory && activeTab.isDirty);

  const handleSave = async () => {
    const saved = await saveActiveTab();
    if (saved) {
      void refreshGitStatus();
    }
  };

  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Workspace toolbar">
      <div className={styles.breadcrumb}>
        <span className={styles.fileName} title={activeTab?.relativePath ?? activeTab?.title}>
          {activeTab ? (activeTab.relativePath ?? activeTab.title) : "No file open"}
        </span>
        {activeTab?.isInMemory && <span className={styles.badge}>In-memory buffer</span>}
        {activeTab?.isSecret && <span className={styles.badge}>Secret file</span>}
        {activeTab?.isSaving && <span className={styles.badge}>Saving...</span>}
        {!activeTab?.isSaving && activeTab?.saveError && (
          <span className={styles.badge} title={activeTab.saveError}>
            Save error
          </span>
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.toolBtn}
          onClick={() => void openFolderDialog()}
          title="Open local project folder"
        >
          <FolderOpen size={13} aria-hidden="true" />
          <span>Open Folder</span>
        </button>

        {activeTab && !activeTab.isInMemory && (
          <button
            type="button"
            className={`${styles.toolBtn} ${canSave ? styles.toolBtnActive : ""}`}
            disabled={!canSave || activeTab.isSaving}
            onClick={() => void handleSave()}
            title="Save file (Ctrl+S)"
          >
            <Save size={13} aria-hidden="true" />
            <span>{activeTab.isSaving ? "Saving" : "Save"}</span>
          </button>
        )}

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
