import { FileExplorer } from "../../features/explorer/FileExplorer";
import { FileSearchPanel } from "../../features/search/FileSearchPanel";
import { SettingsPanel } from "../../features/settings/SettingsPanel";
import { useLayoutStore } from "../../stores/layout.store";
import { useWorkspaceStore, type NavSectionId } from "../../stores/workspace.store";
import styles from "./Sidebar.module.scss";

const SECTION_META: Record<NavSectionId, { title: string; futureDescription?: string }> = {
  explorer: { title: "Explorer" },
  search: { title: "Search" },
  graph: {
    title: "Codebase Graph",
    futureDescription:
      "Interactive dependency and architecture graphs are coming in a future phase."
  },
  intent: {
    title: "Intent Mode",
    futureDescription:
      "Evidence-based optimization plans and reviewed diffs are coming in a future phase."
  },
  decisions: {
    title: "Decision Memory",
    futureDescription: "Searchable engineering decision history is coming in a future phase."
  },
  impact: {
    title: "Change Impact",
    futureDescription: "Pre-edit dependency and impact analysis is coming in a future phase."
  },
  settings: { title: "Settings" }
};

export function Sidebar() {
  const activeNav = useWorkspaceStore((s) => s.activeNav);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);

  if (!sidebarVisible) {
    return null;
  }

  const meta = SECTION_META[activeNav];

  return (
    <aside
      className={styles.sidebar}
      style={{ width: `${sidebarWidth}px` }}
      aria-label={meta.title}
      data-testid="workbench-sidebar"
    >
      <div className={styles.header}>
        <h2 className={styles.heading}>{meta.title}</h2>
      </div>

      <div className={styles.body}>
        {activeNav === "explorer" && <FileExplorer />}
        {activeNav === "search" && <FileSearchPanel />}
        {activeNav === "settings" && <SettingsPanel />}

        {activeNav !== "explorer" && activeNav !== "search" && activeNav !== "settings" && (
          <div className={styles.emptyCard}>
            <p className={styles.emptyTitle}>Coming in a future phase.</p>
            <p className={styles.emptyText}>{meta.futureDescription}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
