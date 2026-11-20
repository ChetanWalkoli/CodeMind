import { useState } from "react";
import { DEFAULT_IGNORE_DIRS } from "@codemind/config";
import { useEditorStore } from "../../stores/editor.store";
import { useThemeStore } from "../../stores/theme.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./SettingsPanel.module.scss";

export function SettingsPanel() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const settings = useEditorStore((s) => s.settings);
  const toggleMinimap = useEditorStore((s) => s.toggleMinimap);
  const toggleWordWrap = useEditorStore((s) => s.toggleWordWrap);
  const setTabSize = useEditorStore((s) => s.setTabSize);

  const appInfo = useWorkspaceStore((s) => s.appInfo);
  const platformInfo = useWorkspaceStore((s) => s.platformInfo);
  const isElectron = useWorkspaceStore((s) => s.isElectron);
  const customExcludes = useWorkspaceStore((s) => s.customExcludes);
  const setCustomExcludes = useWorkspaceStore((s) => s.setCustomExcludes);

  const [newPattern, setNewPattern] = useState("");

  const handleAddExclude = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = newPattern.trim();
    if (!trimmed) return;
    void setCustomExcludes([...customExcludes, trimmed]);
    setNewPattern("");
  };

  const handleRemoveExclude = (pattern: string) => {
    void setCustomExcludes(customExcludes.filter((p) => p !== pattern));
  };

  return (
    <div className={styles.panel} data-testid="settings-panel">
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Appearance</h3>
        <div className={styles.row}>
          <span>Theme</span>
          <div className={styles.segmented} role="group" aria-label="Color theme">
            <button
              type="button"
              className={`${styles.segBtn} ${theme === "dark" ? styles.segBtnActive : ""}`}
              onClick={() => void setTheme("dark")}
              aria-pressed={theme === "dark"}
            >
              Dark
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${theme === "light" ? styles.segBtnActive : ""}`}
              onClick={() => void setTheme("light")}
              aria-pressed={theme === "light"}
            >
              Light
            </button>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Editor</h3>
        <div className={styles.row}>
          <span>Indentation</span>
          <div className={styles.segmented} role="group" aria-label="Tab size">
            <button
              type="button"
              className={`${styles.segBtn} ${settings.tabSize === 2 ? styles.segBtnActive : ""}`}
              onClick={() => setTabSize(2)}
              aria-pressed={settings.tabSize === 2}
            >
              2 Spaces
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${settings.tabSize === 4 ? styles.segBtnActive : ""}`}
              onClick={() => setTabSize(4)}
              aria-pressed={settings.tabSize === 4}
            >
              4 Spaces
            </button>
          </div>
        </div>

        <div className={styles.row}>
          <span>Minimap</span>
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.segBtn} ${settings.minimap ? styles.segBtnActive : ""}`}
              onClick={() => {
                if (!settings.minimap) toggleMinimap();
              }}
            >
              On
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${!settings.minimap ? styles.segBtnActive : ""}`}
              onClick={() => {
                if (settings.minimap) toggleMinimap();
              }}
            >
              Off
            </button>
          </div>
        </div>

        <div className={styles.row}>
          <span>Word Wrap</span>
          <div className={styles.segmented}>
            <button
              type="button"
              className={`${styles.segBtn} ${settings.wordWrap === "on" ? styles.segBtnActive : ""}`}
              onClick={() => {
                if (settings.wordWrap !== "on") toggleWordWrap();
              }}
            >
              On
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${settings.wordWrap === "off" ? styles.segBtnActive : ""}`}
              onClick={() => {
                if (settings.wordWrap !== "off") toggleWordWrap();
              }}
            >
              Off
            </button>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Workspace Exclusions</h3>
        <form className={styles.excludeForm} onSubmit={handleAddExclude}>
          <input
            type="text"
            className={styles.excludeInput}
            placeholder="e.g. *.log or tmp/"
            aria-label="Add exclusion pattern"
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
          />
          <button type="submit" className={styles.addBtn}>
            Add
          </button>
        </form>

        {customExcludes.length > 0 && (
          <div className={styles.tagList} aria-label="Custom exclusion patterns">
            {customExcludes.map((pattern) => (
              <span key={pattern} className={styles.tag}>
                <span>{pattern}</span>
                <button
                  type="button"
                  className={styles.removeTagBtn}
                  onClick={() => handleRemoveExclude(pattern)}
                  aria-label={`Remove ${pattern}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className={styles.metaList}>
          <span>Default ignored: {DEFAULT_IGNORE_DIRS.slice(0, 6).join(", ")}...</span>
          <span>Secret files (.env, *.pem, *.key) are excluded from indexing.</span>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Runtime</h3>
        <div className={styles.metaList}>
          <div className={styles.metaItem}>
            <span>Mode</span>
            <span>{isElectron ? "Electron Desktop" : "Browser Preview"}</span>
          </div>
          <div className={styles.metaItem}>
            <span>Version</span>
            <span>{appInfo?.version ?? "0.1.0"}</span>
          </div>
          <div className={styles.metaItem}>
            <span>Platform</span>
            <span>{platformInfo ? `${platformInfo.platform} (${platformInfo.arch})` : "web"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
