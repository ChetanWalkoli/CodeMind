import { ActivitySidebarPanel } from "../../features/activity/ActivityWorkspace";
import { ArchitectureOverviewPanel } from "../../features/architecture/components/ArchitectureOverviewPanel";
import { DecisionSidebarPanel } from "../../features/decisions/DecisionSidebarPanel";
import { FileExplorer } from "../../features/explorer/FileExplorer";
import { ImpactSidebarPanel } from "../../features/impact/ImpactSidebarPanel";
import { IntentSidebarPanel } from "../../features/intent/IntentSidebarPanel";
import { FileSearchPanel } from "../../features/search/FileSearchPanel";
import { SettingsPanel } from "../../features/settings/SettingsPanel";
import { useLayoutStore } from "../../stores/layout.store";
import { useWorkspaceStore, type NavSectionId } from "../../stores/workspace.store";
import styles from "./Sidebar.module.scss";

const SECTION_META: Record<NavSectionId, { title: string }> = {
  overview: { title: "Workspace Overview" },
  explorer: { title: "Explorer" },
  search: { title: "Search" },
  graph: { title: "Codebase Graph" },
  intent: { title: "Intent Mode" },
  decisions: { title: "Decision Memory" },
  impact: { title: "Change Impact" },
  activity: { title: "Activity" },
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
        {(activeNav === "explorer" || activeNav === "overview") && <FileExplorer />}
        {activeNav === "search" && <FileSearchPanel />}
        {activeNav === "graph" && <ArchitectureOverviewPanel />}
        {activeNav === "intent" && <IntentSidebarPanel />}
        {activeNav === "decisions" && <DecisionSidebarPanel />}
        {activeNav === "impact" && <ImpactSidebarPanel />}
        {activeNav === "activity" && <ActivitySidebarPanel />}
        {activeNav === "settings" && <SettingsPanel />}
      </div>
    </aside>
  );
}
