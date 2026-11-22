import { create } from "zustand";
import type {
  AskWhyAnswer,
  DecisionCategory,
  DecisionConflict,
  DecisionCreateRequest,
  DecisionEvidenceInput,
  DecisionGitReference,
  DecisionLifecycleStatus,
  DecisionSearchResult,
  DecisionSuggestion,
  DecisionTimelineEntry,
  EngineeringDecision
} from "@codemind/shared";
import { desktopApi } from "../services/desktopApi";

export type DecisionWorkspaceTab =
  "overview" | "timeline" | "all" | "suggestions" | "ask_why" | "create" | "detail";

interface DecisionState {
  decisions: EngineeringDecision[];
  selectedDecisionId: string | null;
  activeTab: DecisionWorkspaceTab;
  timeline: DecisionTimelineEntry[];
  suggestions: DecisionSuggestion[];
  conflicts: DecisionConflict[];
  searchResults: DecisionSearchResult[] | null;
  askWhyAnswer: AskWhyAnswer | null;
  gitCommits: DecisionGitReference[];
  busy: boolean;
  error: string | null;

  setActiveTab: (tab: DecisionWorkspaceTab) => void;
  selectDecision: (decisionId: string | null) => void;
  clearError: () => void;
  resetForWorkspace: () => void;

  loadAll: (workspaceRoot: string) => Promise<void>;
  createDecision: (req: DecisionCreateRequest) => Promise<EngineeringDecision | null>;
  createFromIntent: (
    workspaceRoot: string,
    intentId: string
  ) => Promise<EngineeringDecision | null>;
  deleteDecision: (workspaceRoot: string, decisionId: string) => Promise<void>;
  transitionStatus: (
    workspaceRoot: string,
    decisionId: string,
    nextStatus: DecisionLifecycleStatus,
    supersededById?: string
  ) => Promise<void>;
  linkEvidence: (
    workspaceRoot: string,
    decisionId: string,
    evidence: DecisionEvidenceInput
  ) => Promise<void>;
  linkCommit: (workspaceRoot: string, decisionId: string, commitSha: string) => Promise<void>;
  loadTimeline: (
    workspaceRoot: string,
    filters?: {
      order?: "newest" | "oldest";
      category?: DecisionCategory;
      status?: DecisionLifecycleStatus;
      query?: string;
    }
  ) => Promise<void>;
  search: (
    workspaceRoot: string,
    params: {
      query?: string;
      category?: DecisionCategory;
      status?: DecisionLifecycleStatus;
      onlyStale?: boolean;
    }
  ) => Promise<void>;
  askWhy: (
    workspaceRoot: string,
    question: string,
    options?: { filePath?: string; symbolName?: string; useAiSynthesis?: boolean }
  ) => Promise<void>;
  verifyAll: (workspaceRoot: string) => Promise<void>;
  revalidate: (
    workspaceRoot: string,
    decisionId: string,
    updatedRationale?: string
  ) => Promise<void>;
  dismissSuggestion: (workspaceRoot: string, suggestionId: string) => Promise<void>;
}

export const useDecisionStore = create<DecisionState>((set, get) => ({
  decisions: [],
  selectedDecisionId: null,
  activeTab: "overview",
  timeline: [],
  suggestions: [],
  conflicts: [],
  searchResults: null,
  askWhyAnswer: null,
  gitCommits: [],
  busy: false,
  error: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  selectDecision: (decisionId) =>
    set({ selectedDecisionId: decisionId, activeTab: decisionId ? "detail" : "overview" }),
  clearError: () => set({ error: null }),
  resetForWorkspace: () =>
    set({
      decisions: [],
      selectedDecisionId: null,
      activeTab: "overview",
      timeline: [],
      suggestions: [],
      conflicts: [],
      searchResults: null,
      askWhyAnswer: null,
      gitCommits: [],
      busy: false,
      error: null
    }),

  async loadAll(workspaceRoot) {
    set({ busy: true, error: null });
    try {
      const [decRes, sugRes, confRes, tlRes, gitRes] = await Promise.all([
        desktopApi.listDecisions({ workspaceRoot }),
        desktopApi.suggestDecisions({ workspaceRoot }),
        desktopApi.detectDecisionConflicts({ workspaceRoot }),
        desktopApi.getDecisionTimeline({ workspaceRoot, order: "newest" }),
        desktopApi.listDecisionGitCommits({ workspaceRoot, limit: 15 })
      ]);
      set({
        decisions: decRes.ok ? decRes.data : [],
        suggestions: sugRes.ok ? sugRes.data : [],
        conflicts: confRes.ok ? confRes.data : [],
        timeline: tlRes.ok ? tlRes.data : [],
        gitCommits: gitRes.ok ? gitRes.data : []
      });
    } finally {
      set({ busy: false });
    }
  },

  async createDecision(req) {
    set({ busy: true, error: null });
    try {
      const res = await desktopApi.createDecision(req);
      if (res.ok) {
        await get().loadAll(req.workspaceRoot);
        set({ selectedDecisionId: res.data.id, activeTab: "detail" });
        return res.data;
      }
      set({ error: res.error.message });
      return null;
    } finally {
      set({ busy: false });
    }
  },

  async createFromIntent(workspaceRoot, intentId) {
    set({ busy: true, error: null });
    try {
      const res = await desktopApi.createDecisionFromIntent({
        workspaceRoot,
        intentId,
        confirmAccepted: false
      });
      if (res.ok) {
        await get().loadAll(workspaceRoot);
        set({ selectedDecisionId: res.data.id, activeTab: "detail" });
        return res.data;
      }
      set({ error: res.error.message });
      return null;
    } finally {
      set({ busy: false });
    }
  },

  async deleteDecision(workspaceRoot, decisionId) {
    const res = await desktopApi.deleteDecision({ workspaceRoot, decisionId });
    if (res.ok && res.data.deleted) {
      if (get().selectedDecisionId === decisionId) {
        set({ selectedDecisionId: null, activeTab: "overview" });
      }
      await get().loadAll(workspaceRoot);
    }
  },

  async transitionStatus(workspaceRoot, decisionId, nextStatus, supersededById) {
    set({ busy: true, error: null });
    try {
      const res = await desktopApi.transitionDecisionStatus({
        workspaceRoot,
        decisionId,
        nextStatus,
        supersededById
      });
      if (res.ok) {
        await get().loadAll(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false });
    }
  },

  async linkEvidence(workspaceRoot, decisionId, evidence) {
    set({ busy: true, error: null });
    try {
      const res = await desktopApi.linkDecisionEvidence({ workspaceRoot, decisionId, evidence });
      if (res.ok) {
        await get().loadAll(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false });
    }
  },

  async linkCommit(workspaceRoot, decisionId, commitSha) {
    set({ busy: true, error: null });
    try {
      const res = await desktopApi.linkDecisionCommit({ workspaceRoot, decisionId, commitSha });
      if (res.ok) {
        await get().loadAll(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false });
    }
  },

  async loadTimeline(workspaceRoot, filters) {
    const res = await desktopApi.getDecisionTimeline({
      workspaceRoot,
      order: filters?.order ?? "newest",
      category: filters?.category,
      status: filters?.status,
      query: filters?.query
    });
    if (res.ok) {
      set({ timeline: res.data });
    }
  },

  async search(workspaceRoot, params) {
    set({ busy: true, error: null });
    try {
      const res = await desktopApi.searchDecisions({
        workspaceRoot,
        query: params.query ?? "",
        category: params.category,
        status: params.status,
        onlyStale: params.onlyStale,
        limit: 25
      });
      if (res.ok) {
        set({ searchResults: res.data });
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false });
    }
  },

  async askWhy(workspaceRoot, question, options) {
    set({ busy: true, error: null });
    try {
      const res = await desktopApi.askWhyDecision({
        workspaceRoot,
        question,
        filePath: options?.filePath,
        symbolName: options?.symbolName,
        useAiSynthesis: options?.useAiSynthesis
      });
      if (res.ok) {
        set({ askWhyAnswer: res.data });
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false });
    }
  },

  async verifyAll(workspaceRoot) {
    set({ busy: true, error: null });
    try {
      const res = await desktopApi.verifyAllDecisions({ workspaceRoot });
      if (res.ok) {
        await get().loadAll(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false });
    }
  },

  async revalidate(workspaceRoot, decisionId, updatedRationale) {
    set({ busy: true, error: null });
    try {
      const res = await desktopApi.revalidateDecision({
        workspaceRoot,
        decisionId,
        updatedRationale,
        confirmedByDeveloper: true
      });
      if (res.ok) {
        await get().loadAll(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false });
    }
  },

  async dismissSuggestion(workspaceRoot, suggestionId) {
    await desktopApi.dismissDecisionSuggestion({ workspaceRoot, suggestionId });
    await get().loadAll(workspaceRoot);
  }
}));
