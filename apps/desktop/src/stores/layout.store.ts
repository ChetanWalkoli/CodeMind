import { create } from "zustand";

export const LAYOUT_LIMITS = {
  SIDEBAR_MIN: 200,
  SIDEBAR_MAX: 420,
  SIDEBAR_DEFAULT: 260,
  RIGHT_MIN: 240,
  RIGHT_MAX: 480,
  RIGHT_DEFAULT: 300,
  BOTTOM_MIN: 120,
  BOTTOM_MAX: 380,
  BOTTOM_DEFAULT: 180
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

interface LayoutState {
  sidebarWidth: number;
  rightPanelWidth: number;
  bottomPanelHeight: number;
  sidebarVisible: boolean;
  rightPanelVisible: boolean;
  bottomPanelVisible: boolean;

  setSidebarWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  setBottomPanelHeight: (height: number) => void;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  toggleRightPanel: () => void;
  toggleBottomPanel: () => void;
  resetLayout: () => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarWidth: LAYOUT_LIMITS.SIDEBAR_DEFAULT,
  rightPanelWidth: LAYOUT_LIMITS.RIGHT_DEFAULT,
  bottomPanelHeight: LAYOUT_LIMITS.BOTTOM_DEFAULT,
  sidebarVisible: true,
  rightPanelVisible: true,
  bottomPanelVisible: true,

  setSidebarWidth(width) {
    set({ sidebarWidth: clamp(width, LAYOUT_LIMITS.SIDEBAR_MIN, LAYOUT_LIMITS.SIDEBAR_MAX) });
  },

  setRightPanelWidth(width) {
    set({ rightPanelWidth: clamp(width, LAYOUT_LIMITS.RIGHT_MIN, LAYOUT_LIMITS.RIGHT_MAX) });
  },

  setBottomPanelHeight(height) {
    set({
      bottomPanelHeight: clamp(height, LAYOUT_LIMITS.BOTTOM_MIN, LAYOUT_LIMITS.BOTTOM_MAX)
    });
  },

  toggleSidebar() {
    set((state) => ({ sidebarVisible: !state.sidebarVisible }));
  },

  setSidebarVisible(visible) {
    set({ sidebarVisible: visible });
  },

  toggleRightPanel() {
    set((state) => ({ rightPanelVisible: !state.rightPanelVisible }));
  },

  toggleBottomPanel() {
    set((state) => ({ bottomPanelVisible: !state.bottomPanelVisible }));
  },

  resetLayout() {
    set({
      sidebarWidth: LAYOUT_LIMITS.SIDEBAR_DEFAULT,
      rightPanelWidth: LAYOUT_LIMITS.RIGHT_DEFAULT,
      bottomPanelHeight: LAYOUT_LIMITS.BOTTOM_DEFAULT,
      sidebarVisible: true,
      rightPanelVisible: true,
      bottomPanelVisible: true
    });
  }
}));
