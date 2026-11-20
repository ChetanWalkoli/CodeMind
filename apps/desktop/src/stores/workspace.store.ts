import { create } from "zustand";
import type { AppInfo, PlatformInfo } from "@codemind/shared";
import { desktopApi } from "../services/desktopApi";

export type NavSectionId =
  "explorer" | "search" | "graph" | "intent" | "decisions" | "impact" | "settings";

export type BottomPanelTabId = "problems" | "output" | "terminal";

export type BridgeStatus = "initializing" | "ready" | "degraded";

interface WorkspaceState {
  activeNav: NavSectionId;
  activeBottomTab: BottomPanelTabId;
  isElectron: boolean;
  bridgeStatus: BridgeStatus;
  appInfo: AppInfo | null;
  platformInfo: PlatformInfo | null;

  setActiveNav: (nav: NavSectionId) => void;
  setActiveBottomTab: (tab: BottomPanelTabId) => void;
  initializeRuntime: () => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeNav: "explorer",
  activeBottomTab: "problems",
  isElectron: desktopApi.isElectron(),
  bridgeStatus: "initializing",
  appInfo: null,
  platformInfo: null,

  setActiveNav(nav) {
    set({ activeNav: nav });
  },

  setActiveBottomTab(tab) {
    set({ activeBottomTab: tab });
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
  }
}));
