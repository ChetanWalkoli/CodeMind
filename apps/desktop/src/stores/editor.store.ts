import { create } from "zustand";
import { SAMPLE_DOCUMENTS } from "../data/sampleDocuments";
import { desktopApi } from "../services/desktopApi";
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
  workspaceRoot?: string;
  relativePath?: string;
  contentHash?: string;
  isSecret?: boolean;
  isSaving?: boolean;
  lastSavedAt?: number;
  externalConflict?: boolean;
  saveError?: string | null;
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
  conflictTabId: string | null;
  cursor: CursorPosition;
  settings: EditorSettings;
  scratchCounter: number;

  openTab: (doc: { id: string; title: string; content: string; isInMemory?: boolean }) => void;
  openWorkspaceFile: (
    workspaceRoot: string,
    relativePath: string
  ) => Promise<{ ok: boolean; error?: string }>;
  createScratchTab: (extension?: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  saveTab: (tabId: string, force?: boolean) => Promise<boolean>;
  saveActiveTab: (force?: boolean) => Promise<boolean>;
  reloadTabFromDisk: (tabId: string) => Promise<boolean>;
  dismissConflict: (tabId: string) => void;
  checkActiveTabExternalChanges: () => Promise<void>;
  requestCloseTab: (tabId: string) => void;
  cancelPendingClose: () => void;
  confirmPendingClose: () => void;
  closeTabForce: (tabId: string) => void;
  clearWorkspaceTabs: () => void;
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
  workspaceRoot?: string;
  relativePath?: string;
  contentHash?: string;
  isSecret?: boolean;
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
    isInMemory: doc.isInMemory ?? true,
    workspaceRoot: doc.workspaceRoot,
    relativePath: doc.relativePath,
    contentHash: doc.contentHash,
    isSecret: doc.isSecret,
    isSaving: false,
    externalConflict: false,
    saveError: null
  };
}

function makeWorkspaceTabId(workspaceRoot: string, relativePath: string): string {
  return `file::${workspaceRoot}::${relativePath}`;
}

function createInitialTabs(): EditorTab[] {
  return SAMPLE_DOCUMENTS.map((doc) => buildTab({ ...doc, isInMemory: true }));
}

const initialTabs = createInitialTabs();

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: initialTabs,
  activeTabId: initialTabs[0]?.id ?? null,
  pendingCloseTabId: null,
  conflictTabId: null,
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

  async openWorkspaceFile(workspaceRoot, relativePath) {
    const normalizedRel = relativePath.replace(/\\/g, "/");
    const tabId = makeWorkspaceTabId(workspaceRoot, normalizedRel);
    const existing = get().tabs.find((t) => t.id === tabId);
    if (existing) {
      set({ activeTabId: existing.id });
      return { ok: true };
    }

    const response = await desktopApi.readFile({
      workspaceRoot,
      relativePath: normalizedRel
    });

    if (!response.ok) {
      return { ok: false, error: response.error.message };
    }

    const title = normalizedRel.split("/").pop() ?? normalizedRel;
    const nextTab = buildTab({
      id: tabId,
      title,
      content: response.data.content,
      isInMemory: false,
      workspaceRoot,
      relativePath: response.data.relativePath,
      contentHash: response.data.contentHash,
      isSecret: response.data.isSecret
    });

    set((state) => ({
      tabs: [...state.tabs, nextTab],
      activeTabId: nextTab.id,
      cursor: { line: 1, column: 1 }
    }));

    return { ok: true };
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
          isDirty: content !== tab.originalContent,
          saveError: null
        };
      })
    }));
  },

  async saveTab(tabId, force = false) {
    const target = get().tabs.find((t) => t.id === tabId);
    if (!target || target.isInMemory || !target.workspaceRoot || !target.relativePath) {
      return false;
    }

    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, isSaving: true, saveError: null } : t))
    }));

    const response = await desktopApi.writeFile({
      workspaceRoot: target.workspaceRoot,
      relativePath: target.relativePath,
      content: target.content,
      expectedContentHash: target.contentHash,
      force
    });

    if (!response.ok) {
      const isConflict = response.error.code === "EXTERNAL_MODIFICATION_CONFLICT";
      set((state) => ({
        conflictTabId: isConflict ? tabId : state.conflictTabId,
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                isSaving: false,
                externalConflict: isConflict || t.externalConflict,
                saveError: response.error.message
              }
            : t
        )
      }));
      return false;
    }

    set((state) => ({
      conflictTabId: state.conflictTabId === tabId ? null : state.conflictTabId,
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              originalContent: t.content,
              contentHash: response.data.contentHash,
              isDirty: false,
              isSaving: false,
              lastSavedAt: Date.now(),
              externalConflict: false,
              saveError: null
            }
          : t
      )
    }));

    return true;
  },

  async saveActiveTab(force = false) {
    const activeId = get().activeTabId;
    if (!activeId) return false;
    return get().saveTab(activeId, force);
  },

  async reloadTabFromDisk(tabId) {
    const target = get().tabs.find((t) => t.id === tabId);
    if (!target || target.isInMemory || !target.workspaceRoot || !target.relativePath) {
      return false;
    }

    const response = await desktopApi.readFile({
      workspaceRoot: target.workspaceRoot,
      relativePath: target.relativePath
    });

    if (!response.ok) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, saveError: response.error.message } : t
        )
      }));
      return false;
    }

    set((state) => ({
      conflictTabId: state.conflictTabId === tabId ? null : state.conflictTabId,
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              content: response.data.content,
              originalContent: response.data.content,
              contentHash: response.data.contentHash,
              isDirty: false,
              externalConflict: false,
              saveError: null
            }
          : t
      )
    }));

    return true;
  },

  dismissConflict(tabId) {
    set((state) => ({
      conflictTabId: state.conflictTabId === tabId ? null : state.conflictTabId,
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, externalConflict: false } : t))
    }));
  },

  async checkActiveTabExternalChanges() {
    const activeId = get().activeTabId;
    if (!activeId) return;
    const activeTab = get().tabs.find((t) => t.id === activeId);
    if (
      !activeTab ||
      activeTab.isInMemory ||
      !activeTab.workspaceRoot ||
      !activeTab.relativePath ||
      !activeTab.contentHash
    ) {
      return;
    }

    const statRes = await desktopApi.statFile({
      workspaceRoot: activeTab.workspaceRoot,
      relativePath: activeTab.relativePath
    });

    if (!statRes.ok || !statRes.data.exists || !statRes.data.contentHash) {
      return;
    }

    if (statRes.data.contentHash !== activeTab.contentHash) {
      if (!activeTab.isDirty) {
        // Safe auto-reload only when there are no unsaved local edits.
        await get().reloadTabFromDisk(activeTab.id);
      } else {
        set((state) => ({
          conflictTabId: activeTab.id,
          tabs: state.tabs.map((t) =>
            t.id === activeTab.id ? { ...t, externalConflict: true } : t
          )
        }));
      }
    }
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
        conflictTabId: state.conflictTabId === tabId ? null : state.conflictTabId,
        cursor: { line: 1, column: 1 }
      };
    });
  },

  clearWorkspaceTabs() {
    set({
      tabs: [],
      activeTabId: null,
      pendingCloseTabId: null,
      conflictTabId: null,
      cursor: { line: 1, column: 1 }
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
      conflictTabId: null,
      cursor: { line: 1, column: 1 },
      scratchCounter: 1
    });
  }
}));
