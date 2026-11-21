import { create } from "zustand";
import type {
  ArchitectureOverview,
  CodeSymbol,
  DependencyGraphSnapshot,
  FileIntelligence,
  SupportedLanguage
} from "@codemind/shared";
import { desktopApi } from "../services/desktopApi";

const DEFAULT_MAX_VISIBLE_NODES = 60;

interface ArchitectureState {
  overview: ArchitectureOverview | null;
  graphSnapshot: DependencyGraphSnapshot | null;
  selectedNodeId: string | null;
  selectedFileIntel: FileIntelligence | null;
  selectedSymbol: CodeSymbol | null;
  isLoadingGraph: boolean;
  isLoadingInspector: boolean;
  error: string | null;

  searchQuery: string;
  languageFilter: SupportedLanguage | "all";
  moduleFilter: string | "all";
  focusNeighborhood: boolean;
  maxVisibleNodes: number;

  loadArchitecture: (workspaceRoot: string) => Promise<void>;
  selectNode: (workspaceRoot: string, filePath: string | null) => Promise<void>;
  selectSymbol: (symbol: CodeSymbol | null) => void;
  setSearchQuery: (query: string) => void;
  setLanguageFilter: (lang: SupportedLanguage | "all") => void;
  setModuleFilter: (mod: string | "all") => void;
  toggleFocusNeighborhood: () => void;
  increaseVisibleLimit: () => void;
  resetFilters: () => void;
  clear: () => void;
}

export const useArchitectureStore = create<ArchitectureState>((set, get) => ({
  overview: null,
  graphSnapshot: null,
  selectedNodeId: null,
  selectedFileIntel: null,
  selectedSymbol: null,
  isLoadingGraph: false,
  isLoadingInspector: false,
  error: null,

  searchQuery: "",
  languageFilter: "all",
  moduleFilter: "all",
  focusNeighborhood: false,
  maxVisibleNodes: DEFAULT_MAX_VISIBLE_NODES,

  async loadArchitecture(workspaceRoot) {
    set({ isLoadingGraph: true, error: null });

    const [overviewRes, graphRes] = await Promise.all([
      desktopApi.getArchitectureOverview({ workspaceRoot }),
      desktopApi.getDependencyGraph({ workspaceRoot })
    ]);

    if (!overviewRes.ok || !graphRes.ok) {
      const errorMsg = !overviewRes.ok
        ? overviewRes.error.message
        : !graphRes.ok
          ? graphRes.error.message
          : "Failed to load architecture data.";
      set({
        isLoadingGraph: false,
        error: errorMsg
      });
      return;
    }

    const currentSelected = get().selectedNodeId;
    const stillExists =
      currentSelected !== null && graphRes.data.nodes.some((n) => n.id === currentSelected);

    set({
      overview: overviewRes.data,
      graphSnapshot: graphRes.data,
      selectedNodeId: stillExists ? currentSelected : null,
      selectedFileIntel: stillExists ? get().selectedFileIntel : null,
      selectedSymbol: stillExists ? get().selectedSymbol : null,
      isLoadingGraph: false,
      error: null
    });

    if (stillExists && currentSelected) {
      await get().selectNode(workspaceRoot, currentSelected);
    }
  },

  async selectNode(workspaceRoot, filePath) {
    if (!filePath) {
      set({
        selectedNodeId: null,
        selectedFileIntel: null,
        selectedSymbol: null,
        focusNeighborhood: false
      });
      return;
    }

    set({
      selectedNodeId: filePath,
      selectedSymbol: null,
      isLoadingInspector: true
    });

    const intelRes = await desktopApi.getFileIntelligence({
      workspaceRoot,
      relativePath: filePath
    });

    if (get().selectedNodeId !== filePath) {
      return;
    }

    if (!intelRes.ok) {
      set({
        selectedFileIntel: null,
        isLoadingInspector: false,
        error: intelRes.error.message
      });
      return;
    }

    set({
      selectedFileIntel: intelRes.data,
      isLoadingInspector: false
    });
  },

  selectSymbol(symbol) {
    set({ selectedSymbol: symbol });
  },

  setSearchQuery(query) {
    set({ searchQuery: query });
  },

  setLanguageFilter(lang) {
    set({ languageFilter: lang });
  },

  setModuleFilter(mod) {
    set({ moduleFilter: mod });
  },

  toggleFocusNeighborhood() {
    set((state) => ({ focusNeighborhood: !state.focusNeighborhood }));
  },

  increaseVisibleLimit() {
    set((state) => ({ maxVisibleNodes: Math.min(300, state.maxVisibleNodes + 60) }));
  },

  resetFilters() {
    set({
      searchQuery: "",
      languageFilter: "all",
      moduleFilter: "all",
      focusNeighborhood: false,
      maxVisibleNodes: DEFAULT_MAX_VISIBLE_NODES
    });
  },

  clear() {
    set({
      overview: null,
      graphSnapshot: null,
      selectedNodeId: null,
      selectedFileIntel: null,
      selectedSymbol: null,
      isLoadingGraph: false,
      isLoadingInspector: false,
      error: null,
      searchQuery: "",
      languageFilter: "all",
      moduleFilter: "all",
      focusNeighborhood: false,
      maxVisibleNodes: DEFAULT_MAX_VISIBLE_NODES
    });
  }
}));
