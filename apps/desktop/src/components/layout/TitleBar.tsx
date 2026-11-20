import { BrainCircuit, Moon, PanelBottom, PanelLeft, PanelRight, Sun } from "lucide-react";
import { useLayoutStore } from "../../stores/layout.store";
import { useThemeStore } from "../../stores/theme.store";
import styles from "./TitleBar.module.scss";

export function TitleBar() {
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const rightPanelVisible = useLayoutStore((s) => s.rightPanelVisible);
  const bottomPanelVisible = useLayoutStore((s) => s.bottomPanelVisible);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const toggleRightPanel = useLayoutStore((s) => s.toggleRightPanel);
  const toggleBottomPanel = useLayoutStore((s) => s.toggleBottomPanel);

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  return (
    <header className={styles.titleBar}>
      <div className={styles.brandGroup}>
        <span className={styles.brandMark} aria-hidden="true">
          <BrainCircuit size={14} />
        </span>
        <span className={styles.brandName}>CodeMind</span>
        <span className={styles.tagline}>Understand. Improve. Remember.</span>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.iconBtn} ${sidebarVisible ? styles.iconBtnActive : ""}`}
          onClick={toggleSidebar}
          aria-label="Toggle primary sidebar"
          aria-pressed={sidebarVisible}
          title="Toggle Sidebar"
        >
          <PanelLeft size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`${styles.iconBtn} ${bottomPanelVisible ? styles.iconBtnActive : ""}`}
          onClick={toggleBottomPanel}
          aria-label="Toggle bottom panel"
          aria-pressed={bottomPanelVisible}
          title="Toggle Bottom Panel"
        >
          <PanelBottom size={15} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`${styles.iconBtn} ${rightPanelVisible ? styles.iconBtnActive : ""}`}
          onClick={toggleRightPanel}
          aria-label="Toggle right panel"
          aria-pressed={rightPanelVisible}
          title="Toggle Right Panel"
        >
          <PanelRight size={15} aria-hidden="true" />
        </button>

        <span className={styles.divider} aria-hidden="true" />

        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void toggleTheme()}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? (
            <Sun size={15} aria-hidden="true" />
          ) : (
            <Moon size={15} aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
