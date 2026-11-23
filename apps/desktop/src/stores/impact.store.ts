import { create } from "zustand";
import type {
  ImpactAnalysisResult,
  ImpactAnalysisSummary,
  ImpactChangeType,
  ImpactValidationStepStatus
} from "@codemind/shared";
import { desktopApi } from "../services/desktopApi";

export type ImpactWorkspaceTab =
  "overview" | "files" | "contracts" | "tests" | "decisions" | "validation";

interface ImpactState {
  summaries: ImpactAnalysisSummary[];
  activeAnalysis: ImpactAnalysisResult | null;
  activeTab: ImpactWorkspaceTab;
  selectedNodeId: string | null;
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;

  setActiveTab: (tab: ImpactWorkspaceTab) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  clearError: () => void;
  reset: () => void;

  loadSummaries: (workspaceRoot: string) => Promise<void>;
  selectAnalysis: (workspaceRoot: string, analysisId: string) => Promise<void>;
  analyzeFiles: (params: {
    workspaceRoot: string;
    filePaths: string[];
    symbolName?: string;
    changeType?: ImpactChangeType;
    maxDepth?: number;
    maxAffectedFiles?: number;
  }) => Promise<ImpactAnalysisResult | null>;
  analyzeGitDiff: (
    workspaceRoot: string,
    maxDepth?: number
  ) => Promise<ImpactAnalysisResult | null>;
  checkFreshness: (workspaceRoot: string, analysisId: string) => Promise<void>;
  updateValidationStep: (
    workspaceRoot: string,
    analysisId: string,
    stepId: string,
    status: ImpactValidationStepStatus
  ) => Promise<void>;
  deleteAnalysis: (workspaceRoot: string, analysisId: string) => Promise<void>;
}

export const useImpactStore = create<ImpactState>((set, get) => ({
  summaries: [],
  activeAnalysis: null,
  activeTab: "overview",
  selectedNodeId: null,
  isLoading: false,
  isAnalyzing: false,
  error: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
  clearError: () => set({ error: null }),
  reset: () =>
    set({
      summaries: [],
      activeAnalysis: null,
      activeTab: "overview",
      selectedNodeId: null,
      isLoading: false,
      isAnalyzing: false,
      error: null
    }),

  loadSummaries: async (workspaceRoot) => {
    set({ isLoading: true, error: null });
    const res = await desktopApi.listImpactAnalyses({ workspaceRoot });
    if (res.ok) {
      set({ summaries: res.data, isLoading: false });
    } else {
      set({ isLoading: false, error: res.error.message });
    }
  },

  selectAnalysis: async (workspaceRoot, analysisId) => {
    set({ isLoading: true, error: null, selectedNodeId: null });
    const res = await desktopApi.getImpactAnalysis({ workspaceRoot, analysisId });
    if (res.ok) {
      set({ activeAnalysis: res.data, isLoading: false });
    } else {
      set({ isLoading: false, error: res.error.message });
    }
  },

  analyzeFiles: async (params) => {
    const cleanPaths = params.filePaths.map((p) => p.trim()).filter(Boolean);
    if (cleanPaths.length === 0) {
      set({ error: "Enter or select at least one workspace file path to analyze." });
      return null;
    }

    set({ isAnalyzing: true, error: null, selectedNodeId: null });
    const res = await desktopApi.analyzeChangeImpact({
      workspaceRoot: params.workspaceRoot,
      targets: cleanPaths.map((filePath) => ({
        filePath,
        symbolName: params.symbolName?.trim() || undefined
      })),
      changeType: params.changeType ?? "file_modified",
      maxDepth: params.maxDepth ?? 3,
      maxAffectedFiles: params.maxAffectedFiles ?? 50
    });

    if (res.ok) {
      set({ activeAnalysis: res.data, activeTab: "overview", isAnalyzing: false });
      await get().loadSummaries(params.workspaceRoot);
      return res.data;
    }

    set({ isAnalyzing: false, error: res.error.message });
    return null;
  },

  analyzeGitDiff: async (workspaceRoot, maxDepth = 3) => {
    set({ isAnalyzing: true, error: null, selectedNodeId: null });
    const res = await desktopApi.analyzeGitDiffImpact({
      workspaceRoot,
      maxDepth,
      maxAffectedFiles: 50
    });

    if (res.ok) {
      set({ activeAnalysis: res.data, activeTab: "overview", isAnalyzing: false });
      await get().loadSummaries(workspaceRoot);
      return res.data;
    }

    set({ isAnalyzing: false, error: res.error.message });
    return null;
  },

  checkFreshness: async (workspaceRoot, analysisId) => {
    const res = await desktopApi.checkImpactFreshness({ workspaceRoot, analysisId });
    if (res.ok) {
      set({ activeAnalysis: res.data });
      await get().loadSummaries(workspaceRoot);
    } else {
      set({ error: res.error.message });
    }
  },

  updateValidationStep: async (workspaceRoot, analysisId, stepId, status) => {
    const res = await desktopApi.updateImpactValidationStep({
      workspaceRoot,
      analysisId,
      stepId,
      status
    });
    if (res.ok) {
      set({ activeAnalysis: res.data });
    } else {
      set({ error: res.error.message });
    }
  },

  deleteAnalysis: async (workspaceRoot, analysisId) => {
    const res = await desktopApi.deleteImpactAnalysis({ workspaceRoot, analysisId });
    if (res.ok) {
      const current = get().activeAnalysis;
      if (current?.analysisId === analysisId) {
        set({ activeAnalysis: null, selectedNodeId: null });
      }
      await get().loadSummaries(workspaceRoot);
    } else {
      set({ error: res.error.message });
    }
  }
}));
