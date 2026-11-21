import { create } from "zustand";
import type {
  AppInfo,
  FileTreeNode,
  GitStatus,
  IndexSummary,
  PlatformInfo,
  WorkspaceInfo,
  WorkspaceSession
} from "@codemind/shared";
import { desktopApi } from "../services/desktopApi";
import { useArchitectureStore } from "./architecture.store";
import { useEditorStore } from "./editor.store";
import { useLayoutStore } from "./layout.store";

export type CenterViewMode = "editor" | "architecture";

export type NavSectionId =
  "explorer" | "search" | "graph" | "intent" | "decisions" | "impact" | "settings";

export type BottomPanelTabId = "problems" | "output" | "terminal";

export type BridgeStatus = "initializing" | "ready" | "degraded";

interface WorkspaceState {
  activeNav: NavSectionId;
  activeBottomTab: BottomPanelTabId;
  centerView: CenterViewMode;
  isElectron: boolean;
  bridgeStatus: BridgeStatus;
  appInfo: AppInfo | null;
  platformInfo: PlatformInfo | null;

  workspace: WorkspaceInfo | null;
  rootNodes: FileTreeNode[];
  childrenByPath: Record<string, FileTreeNode[]>;
  expandedPaths: Record<string, boolean>;
  loadingPaths: Record<string, boolean>;
  isTreeLoading: boolean;
  isIndexing: boolean;
  indexSummary: IndexSummary | null;
  gitStatus: GitStatus | null;
  customExcludes: string[];
  workspaceError: string | null;

  setActiveNav: (nav: NavSectionId) => void;
  setActiveBottomTab: (tab: BottomPanelTabId) => void;
  setCenterView: (view: CenterViewMode) => void;
  initializeRuntime: () => Promise<void>;
  openFolderDialog: () => Promise<boolean>;
  openWorkspacePath: (
    rootPath: string,
    restoreTabs?: string[],
    activeTabPath?: string | null
  ) => Promise<boolean>;
  restoreLastWorkspace: () => Promise<void>;
  toggleDirectory: (relativePath: string) => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  refreshIndex: (incremental?: boolean) => Promise<void>;
  refreshGitStatus: () => Promise<void>;
  setCustomExcludes: (patterns: string[]) => Promise<void>;
  persistSession: () => Promise<void>;
  clearWorkspaceError: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeNav: "explorer",
  activeBottomTab: "problems",
  centerView: "editor",
  isElectron: desktopApi.isElectron(),
  bridgeStatus: "initializing",
  appInfo: null,
  platformInfo: null,

  workspace: null,
  rootNodes: [],
  childrenByPath: {},
  expandedPaths: {},
  loadingPaths: {},
  isTreeLoading: false,
  isIndexing: false,
  indexSummary: null,
  gitStatus: null,
  customExcludes: [],
  workspaceError: null,

  setActiveNav(nav) {
    set((state) => ({
      activeNav: nav,
      centerView: nav === "graph" ? "architecture" : state.centerView
    }));
  },

  setActiveBottomTab(tab) {
    set({ activeBottomTab: tab });
  },

  setCenterView(view) {
    set({ centerView: view });
  },

  async initializeRuntime() {
    const isElectron = desktopApi.isElectron();
    const [appRes, platformRes, healthRes] = await Promise.all([
      desktopApi.getAppInfo(),
      desktopApi.getPlatformInfo(),
      desktopApi.healthCheck()
    ]);

    set({
      isElectron,
      appInfo: appRes.ok ? appRes.data : null,
      platformInfo: platformRes.ok ? platformRes.data : null,
      bridgeStatus: healthRes.ok && healthRes.data.status === "ready" ? "ready" : "degraded"
    });
  },

  async openFolderDialog() {
    set({ workspaceError: null });
    const res = await desktopApi.selectWorkspaceFolder();
    if (!res.ok) {
      set({ workspaceError: res.error.message });
      return false;
    }
    if (!res.data) {
      return false;
    }

    return get().openWorkspacePath(res.data.rootPath);
  },

  async openWorkspacePath(rootPath, restoreTabs = [], activeTabPath = null) {
    set({ isTreeLoading: true, workspaceError: null });
    const openRes = await desktopApi.openWorkspace({ rootPath });
    if (!openRes.ok) {
      set({
        isTreeLoading: false,
        workspace: null,
        rootNodes: [],
        childrenByPath: {},
        expandedPaths: {},
        gitStatus: null,
        workspaceError: openRes.error.message
      });
      return false;
    }

    const workspace = openRes.data;
    const excludes = get().customExcludes;

    const [treeRes, gitRes] = await Promise.all([
      desktopApi.getWorkspaceTree({
        workspaceRoot: workspace.rootPath,
        relativeDir: "",
        customExcludes: excludes
      }),
      desktopApi.getGitStatus({ workspaceRoot: workspace.rootPath })
    ]);

    set({
      workspace,
      rootNodes: treeRes.ok ? treeRes.data : [],
      childrenByPath: {},
      expandedPaths: {},
      loadingPaths: {},
      isTreeLoading: false,
      gitStatus: gitRes.ok ? gitRes.data : null,
      workspaceError: treeRes.ok ? null : treeRes.error.message
    });

    // Clear sample scratch tabs & previous architecture state when switching into a real workspace.
    useArchitectureStore.getState().clear();
    const editorStore = useEditorStore.getState();
    editorStore.clearWorkspaceTabs();

    for (const relPath of restoreTabs) {
      await useEditorStore.getState().openWorkspaceFile(workspace.rootPath, relPath);
    }

    if (activeTabPath) {
      const targetTab = useEditorStore
        .getState()
        .tabs.find((t) => t.relativePath === activeTabPath);
      if (targetTab) {
        useEditorStore.getState().setActiveTab(targetTab.id);
      }
    }

    await get().persistSession();
    void get().refreshIndex(false);
    return true;
  },

  async restoreLastWorkspace() {
    const sessionRes = await desktopApi.getWorkspaceSession();
    if (!sessionRes.ok) {
      return;
    }

    const session = sessionRes.data;
    set({ customExcludes: session.customExcludes ?? [] });

    if (session.layout) {
      const layoutStore = useLayoutStore.getState();
      layoutStore.setSidebarWidth(session.layout.sidebarWidth);
      layoutStore.setRightPanelWidth(session.layout.rightPanelWidth);
      layoutStore.setBottomPanelHeight(session.layout.bottomPanelHeight);
      if (layoutStore.sidebarVisible !== session.layout.sidebarVisible) {
        layoutStore.toggleSidebar();
      }
      if (layoutStore.rightPanelVisible !== session.layout.rightPanelVisible) {
        layoutStore.toggleRightPanel();
      }
      if (layoutStore.bottomPanelVisible !== session.layout.bottomPanelVisible) {
        layoutStore.toggleBottomPanel();
      }
    }

    if (session.lastWorkspacePath && desktopApi.isElectron()) {
      const opened = await get().openWorkspacePath(
        session.lastWorkspacePath,
        session.openTabPaths,
        session.activeTabPath
      );
      if (!opened) {
        set({
          workspaceError: `Previous workspace could not be restored: ${session.lastWorkspacePath}`
        });
      }
    }
  },

  async toggleDirectory(relativePath) {
    const workspace = get().workspace;
    if (!workspace) return;

    const currentlyExpanded = Boolean(get().expandedPaths[relativePath]);
    if (currentlyExpanded) {
      set((state) => ({
        expandedPaths: { ...state.expandedPaths, [relativePath]: false }
      }));
      return;
    }

    set((state) => ({
      expandedPaths: { ...state.expandedPaths, [relativePath]: true },
      loadingPaths: { ...state.loadingPaths, [relativePath]: true }
    }));

    const res = await desktopApi.getWorkspaceTree({
      workspaceRoot: workspace.rootPath,
      relativeDir: relativePath,
      customExcludes: get().customExcludes
    });

    set((state) => ({
      childrenByPath: res.ok
        ? { ...state.childrenByPath, [relativePath]: res.data }
        : state.childrenByPath,
      loadingPaths: { ...state.loadingPaths, [relativePath]: false },
      workspaceError: res.ok ? state.workspaceError : res.error.message
    }));
  },

  async refreshWorkspace() {
    const workspace = get().workspace;
    if (!workspace) return;

    set({ isTreeLoading: true });
    const excludes = get().customExcludes;
    const expanded = Object.entries(get().expandedPaths)
      .filter(([, isOpen]) => isOpen)
      .map(([rel]) => rel);

    const [rootRes, gitRes] = await Promise.all([
      desktopApi.getWorkspaceTree({
        workspaceRoot: workspace.rootPath,
        relativeDir: "",
        customExcludes: excludes
      }),
      desktopApi.getGitStatus({ workspaceRoot: workspace.rootPath })
    ]);

    const nextChildren: Record<string, FileTreeNode[]> = {};
    for (const dir of expanded) {
      const dirRes = await desktopApi.getWorkspaceTree({
        workspaceRoot: workspace.rootPath,
        relativeDir: dir,
        customExcludes: excludes
      });
      if (dirRes.ok) {
        nextChildren[dir] = dirRes.data;
      }
    }

    set({
      rootNodes: rootRes.ok ? rootRes.data : get().rootNodes,
      childrenByPath: nextChildren,
      gitStatus: gitRes.ok ? gitRes.data : get().gitStatus,
      isTreeLoading: false
    });
  },

  async refreshIndex(incremental = true) {
    const workspace = get().workspace;
    if (!workspace) return;
    set({ isIndexing: true });
    const res = await desktopApi.indexWorkspace({
      workspaceRoot: workspace.rootPath,
      incremental,
      customExcludes: get().customExcludes
    });
    set({
      isIndexing: false,
      indexSummary: res.ok ? res.data : get().indexSummary
    });
  },

  async refreshGitStatus() {
    const workspace = get().workspace;
    if (!workspace) return;
    const res = await desktopApi.getGitStatus({ workspaceRoot: workspace.rootPath });
    if (res.ok) {
      set({ gitStatus: res.data });
    }
  },

  async setCustomExcludes(patterns) {
    const cleaned = Array.from(new Set(patterns.map((p) => p.trim()).filter((p) => p.length > 0)));
    set({ customExcludes: cleaned });
    await get().persistSession();
    if (get().workspace) {
      await get().refreshWorkspace();
    }
  },

  async persistSession() {
    const workspace = get().workspace;
    const editorState = useEditorStore.getState();
    const layoutState = useLayoutStore.getState();

    const diskTabs = editorState.tabs.filter(
      (t) => !t.isInMemory && t.workspaceRoot === workspace?.rootPath && t.relativePath
    );
    const activeDiskTab = diskTabs.find((t) => t.id === editorState.activeTabId);

    const session: WorkspaceSession = {
      lastWorkspacePath: workspace?.rootPath ?? null,
      openTabPaths: diskTabs.map((t) => t.relativePath!),
      activeTabPath: activeDiskTab?.relativePath ?? null,
      customExcludes: get().customExcludes,
      layout: {
        sidebarWidth: layoutState.sidebarWidth,
        rightPanelWidth: layoutState.rightPanelWidth,
        bottomPanelHeight: layoutState.bottomPanelHeight,
        sidebarVisible: layoutState.sidebarVisible,
        rightPanelVisible: layoutState.rightPanelVisible,
        bottomPanelVisible: layoutState.bottomPanelVisible
      }
    };

    await desktopApi.saveWorkspaceSession(session);
  },

  clearWorkspaceError() {
    set({ workspaceError: null });
  }
}));
