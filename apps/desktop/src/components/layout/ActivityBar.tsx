import {
  Activity,
  BookMarked,
  Files,
  GitBranch,
  Home,
  Network,
  Search,
  Settings,
  Sparkles,
  type LucideIcon
} from "lucide-react";
import { useLayoutStore } from "../../stores/layout.store";
import { useWorkspaceStore, type NavSectionId } from "../../stores/workspace.store";
import styles from "./ActivityBar.module.scss";

interface NavItem {
  id: NavSectionId;
  label: string;
  icon: LucideIcon;
}

const PRIMARY_NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "explorer", label: "Explorer", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "graph", label: "Codebase Graph", icon: Network },
  { id: "intent", label: "Intent Mode", icon: Sparkles },
  { id: "decisions", label: "Decision Memory", icon: BookMarked },
  { id: "impact", label: "Change Impact", icon: GitBranch }
];

const FOOTER_NAV_ITEMS: NavItem[] = [
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings }
];

export function ActivityBar() {
  const activeNav = useWorkspaceStore((s) => s.activeNav);
  const setActiveNav = useWorkspaceStore((s) => s.setActiveNav);
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const setSidebarVisible = useLayoutStore((s) => s.setSidebarVisible);

  const handleSelect = (id: NavSectionId) => {
    if (activeNav === id && sidebarVisible) {
      setSidebarVisible(false);
    } else {
      setActiveNav(id);
      setSidebarVisible(true);
    }
  };

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeNav === item.id && sidebarVisible;

    return (
      <button
        key={item.id}
        type="button"
        className={`${styles.navButton} ${isActive ? styles.navButtonActive : ""}`}
        onClick={() => handleSelect(item.id)}
        aria-label={item.label}
        aria-current={isActive ? "page" : undefined}
        title={item.label}
      >
        <Icon size={18} aria-hidden="true" />
      </button>
    );
  };

  return (
    <nav className={styles.activityBar} aria-label="Workspace navigation">
      <div className={styles.group}>{PRIMARY_NAV_ITEMS.map(renderItem)}</div>
      <div className={styles.group}>{FOOTER_NAV_ITEMS.map(renderItem)}</div>
    </nav>
  );
}
