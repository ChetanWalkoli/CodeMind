import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../editor.store";
import { LAYOUT_LIMITS, useLayoutStore } from "../layout.store";
import { useThemeStore } from "../theme.store";
import { useWorkspaceStore } from "../workspace.store";

describe("Zustand stores", () => {
  beforeEach(() => {
    useEditorStore.getState().resetToInitial();
    useLayoutStore.getState().resetLayout();
    window.localStorage.clear();
  });

  it("manages editor tabs, dirty tracking, and close confirmation", () => {
    const store = useEditorStore.getState();
    const initialCount = store.tabs.length;
    const firstTab = store.tabs[0]!;

    // Modify tab content -> becomes dirty
    store.updateTabContent(firstTab.id, `${firstTab.content}\n// edited`);
    expect(useEditorStore.getState().tabs[0]?.isDirty).toBe(true);

    // Requesting close on a dirty tab triggers confirmation instead of immediate close
    useEditorStore.getState().requestCloseTab(firstTab.id);
    expect(useEditorStore.getState().pendingCloseTabId).toBe(firstTab.id);
    expect(useEditorStore.getState().tabs).toHaveLength(initialCount);

    // Cancelling preserves tab
    useEditorStore.getState().cancelPendingClose();
    expect(useEditorStore.getState().pendingCloseTabId).toBeNull();
    expect(useEditorStore.getState().tabs).toHaveLength(initialCount);

    // Confirming closes the tab and selects next active tab
    useEditorStore.getState().requestCloseTab(firstTab.id);
    useEditorStore.getState().confirmPendingClose();
    expect(useEditorStore.getState().tabs).toHaveLength(initialCount - 1);
    expect(useEditorStore.getState().activeTabId).not.toBe(firstTab.id);
  });

  it("updates editor settings predictably", () => {
    const store = useEditorStore.getState();
    expect(store.settings.minimap).toBe(true);
    store.toggleMinimap();
    expect(useEditorStore.getState().settings.minimap).toBe(false);

    store.toggleWordWrap();
    expect(useEditorStore.getState().settings.wordWrap).toBe("on");

    store.setTabSize(4);
    expect(useEditorStore.getState().settings.tabSize).toBe(4);
  });

  it("clamps layout panel dimensions within min/max bounds", () => {
    const layout = useLayoutStore.getState();

    layout.setSidebarWidth(50);
    expect(useLayoutStore.getState().sidebarWidth).toBe(LAYOUT_LIMITS.SIDEBAR_MIN);

    layout.setSidebarWidth(999);
    expect(useLayoutStore.getState().sidebarWidth).toBe(LAYOUT_LIMITS.SIDEBAR_MAX);

    layout.setBottomPanelHeight(10);
    expect(useLayoutStore.getState().bottomPanelHeight).toBe(LAYOUT_LIMITS.BOTTOM_MIN);

    layout.toggleRightPanel();
    expect(useLayoutStore.getState().rightPanelVisible).toBe(false);
  });

  it("updates workspace navigation and bottom panel tabs", () => {
    const workspace = useWorkspaceStore.getState();
    workspace.setActiveNav("settings");
    expect(useWorkspaceStore.getState().activeNav).toBe("settings");

    workspace.setActiveBottomTab("terminal");
    expect(useWorkspaceStore.getState().activeBottomTab).toBe("terminal");
  });

  it("persists and toggles theme state cleanly", async () => {
    await useThemeStore.getState().setTheme("light");
    expect(useThemeStore.getState().theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
