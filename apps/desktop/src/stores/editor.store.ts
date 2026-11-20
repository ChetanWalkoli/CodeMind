import { create } from "zustand";
import { SAMPLE_DOCUMENTS } from "../data/sampleDocuments";
import { detectEditorLanguage, type EditorLanguageId } from "../utils/languageDetection";

export interface EditorTab {
  id: string;
  title: string;
  content: string;
  originalContent: string;
  language: EditorLanguageId;
  languageLabel: string;
  isDirty: boolean;
  isInMemory: boolean;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface EditorSettings {
  minimap: boolean;
  wordWrap: "on" | "off";
  tabSize: 2 | 4;
  fontSize: number;
}

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  pendingCloseTabId: string | null;
  cursor: CursorPosition;
  settings: EditorSettings;
  scratchCounter: number;

  openTab: (doc: { id: string; title: string; content: string; isInMemory?: boolean }) => void;
  createScratchTab: (extension?: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  requestCloseTab: (tabId: string) => void;
  cancelPendingClose: () => void;
  confirmPendingClose: () => void;
  closeTabForce: (tabId: string) => void;
  setCursor: (cursor: CursorPosition) => void;
  toggleMinimap: () => void;
  toggleWordWrap: () => void;
  setTabSize: (tabSize: 2 | 4) => void;
  setFontSize: (fontSize: number) => void;
  resetToInitial: () => void;
}

function buildTab(doc: {
  id: string;
  title: string;
  content: string;
  isInMemory?: boolean;
}): EditorTab {
  const detected = detectEditorLanguage(doc.title);
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    originalContent: doc.content,
    language: detected.monacoId,
    languageLabel: detected.label,
    isDirty: false,
    isInMemory: doc.isInMemory ?? true
  };
}

function createInitialTabs(): EditorTab[] {
  return SAMPLE_DOCUMENTS.map((doc) => buildTab({ ...doc, isInMemory: true }));
}

const initialTabs = createInitialTabs();

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: initialTabs,
  activeTabId: initialTabs[0]?.id ?? null,
  pendingCloseTabId: null,
  cursor: { line: 1, column: 1 },
  settings: {
    minimap: true,
    wordWrap: "off",
    tabSize: 2,
    fontSize: 13
  },
  scratchCounter: 1,

  openTab(doc) {
    const existing = get().tabs.find((t) => t.id === doc.id);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const nextTab = buildTab(doc);
    set((state) => ({
      tabs: [...state.tabs, nextTab],
      activeTabId: nextTab.id,
      cursor: { line: 1, column: 1 }
    }));
  },

  createScratchTab(extension = ".ts") {
    const counter = get().scratchCounter;
    const ext = extension.startsWith(".") ? extension : `.${extension}`;
    const title = `untitled-${counter}${ext}`;
    const id = `scratch-untitled-${counter}-${Date.now()}`;
    const tab = buildTab({
      id,
      title,
      content: "",
      isInMemory: true
    });

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      scratchCounter: state.scratchCounter + 1,
      cursor: { line: 1, column: 1 }
    }));
  },

  setActiveTab(tabId) {
    if (get().tabs.some((t) => t.id === tabId)) {
      set({ activeTabId: tabId, cursor: { line: 1, column: 1 } });
    }
  },

  updateTabContent(tabId, content) {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          content,
          isDirty: content !== tab.originalContent
        };
      })
    }));
  },

  requestCloseTab(tabId) {
    const target = get().tabs.find((t) => t.id === tabId);
    if (!target) return;

    if (target.isDirty) {
      set({ pendingCloseTabId: tabId });
      return;
    }

    get().closeTabForce(tabId);
  },

  cancelPendingClose() {
    set({ pendingCloseTabId: null });
  },

  confirmPendingClose() {
    const pendingId = get().pendingCloseTabId;
    if (!pendingId) return;
    set({ pendingCloseTabId: null });
    get().closeTabForce(pendingId);
  },

  closeTabForce(tabId) {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;

      const nextTabs = state.tabs.filter((t) => t.id !== tabId);
      let nextActiveId = state.activeTabId;

      if (state.activeTabId === tabId) {
        const fallbackTab = nextTabs[idx] ?? nextTabs[idx - 1] ?? null;
        nextActiveId = fallbackTab ? fallbackTab.id : null;
      }

      return {
        tabs: nextTabs,
        activeTabId: nextActiveId,
        pendingCloseTabId: state.pendingCloseTabId === tabId ? null : state.pendingCloseTabId,
        cursor: { line: 1, column: 1 }
      };
    });
  },

  setCursor(cursor) {
    set({ cursor });
  },

  toggleMinimap() {
    set((state) => ({
      settings: { ...state.settings, minimap: !state.settings.minimap }
    }));
  },

  toggleWordWrap() {
    set((state) => ({
      settings: {
        ...state.settings,
        wordWrap: state.settings.wordWrap === "on" ? "off" : "on"
      }
    }));
  },

  setTabSize(tabSize) {
    set((state) => ({
      settings: { ...state.settings, tabSize }
    }));
  },

  setFontSize(fontSize) {
    const clamped = Math.min(24, Math.max(11, Math.round(fontSize)));
    set((state) => ({
      settings: { ...state.settings, fontSize: clamped }
    }));
  },

  resetToInitial() {
    const fresh = createInitialTabs();
    set({
      tabs: fresh,
      activeTabId: fresh[0]?.id ?? null,
      pendingCloseTabId: null,
      cursor: { line: 1, column: 1 },
      scratchCounter: 1
    });
  }
}));
