import { create } from "zustand";
import type {
  IntentSession,
  IntentSessionSummary,
  PatchApprovalEntry,
  PatchReviewDecision,
  RecommendationDecision,
  RollbackCheckResult,
  RollbackMode,
  VerificationCandidateCommand
} from "@codemind/shared";
import { desktopApi } from "../services/desktopApi";

export type IntentWorkspaceTab =
  | "intent"
  | "investigate"
  | "findings"
  | "recommendations"
  | "diff"
  | "apply"
  | "verify"
  | "recovery";

interface IntentState {
  sessions: IntentSessionSummary[];
  activeSession: IntentSession | null;
  activeTab: IntentWorkspaceTab;
  selectedPatchId: string | null;
  verificationCommands: VerificationCandidateCommand[];
  rollbackCheck: RollbackCheckResult | null;
  busy: boolean;
  busyLabel: string | null;
  error: string | null;

  setActiveTab: (tab: IntentWorkspaceTab) => void;
  setSelectedPatchId: (patchId: string | null) => void;
  clearError: () => void;
  resetForWorkspace: () => void;

  loadSessions: (workspaceRoot: string) => Promise<void>;
  selectSession: (workspaceRoot: string, intentId: string) => Promise<void>;
  createIntent: (workspaceRoot: string, prompt: string) => Promise<boolean>;
  clarifyIntent: (
    workspaceRoot: string,
    intentId: string,
    answers: Record<string, string>,
    confirmedCriteriaIds?: string[]
  ) => Promise<void>;
  deleteIntent: (workspaceRoot: string, intentId: string) => Promise<void>;
  investigate: (workspaceRoot: string, intentId: string) => Promise<void>;
  analyze: (workspaceRoot: string, intentId: string) => Promise<void>;
  recommend: (workspaceRoot: string, intentId: string) => Promise<void>;
  decideRecommendation: (
    workspaceRoot: string,
    intentId: string,
    recommendationId: string,
    decision: RecommendationDecision
  ) => Promise<void>;
  generatePatch: (
    workspaceRoot: string,
    intentId: string,
    recommendationIds: string[],
    useAiGeneration?: boolean
  ) => Promise<void>;
  reviewPatches: (
    workspaceRoot: string,
    intentId: string,
    patchIds: string[],
    decision: PatchReviewDecision
  ) => Promise<void>;
  approveAndGetRecord: (
    workspaceRoot: string,
    intentId: string,
    entries: PatchApprovalEntry[]
  ) => Promise<string | null>;
  applyTransaction: (workspaceRoot: string, intentId: string, approvalId: string) => Promise<void>;
  discoverVerification: (workspaceRoot: string, intentId: string) => Promise<void>;
  runVerification: (
    workspaceRoot: string,
    intentId: string,
    commandId: string,
    transactionId?: string
  ) => Promise<void>;
  checkRollback: (workspaceRoot: string, intentId: string, transactionId: string) => Promise<void>;
  executeRollback: (
    workspaceRoot: string,
    intentId: string,
    transactionId: string,
    mode: RollbackMode,
    targetFiles?: string[],
    forceOverwriteModified?: boolean
  ) => Promise<void>;
}

export const useIntentStore = create<IntentState>((set, get) => ({
  sessions: [],
  activeSession: null,
  activeTab: "intent",
  selectedPatchId: null,
  verificationCommands: [],
  rollbackCheck: null,
  busy: false,
  busyLabel: null,
  error: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedPatchId: (patchId) => set({ selectedPatchId: patchId }),
  clearError: () => set({ error: null }),
  resetForWorkspace: () =>
    set({
      sessions: [],
      activeSession: null,
      activeTab: "intent",
      selectedPatchId: null,
      verificationCommands: [],
      rollbackCheck: null,
      busy: false,
      busyLabel: null,
      error: null
    }),

  async loadSessions(workspaceRoot) {
    const res = await desktopApi.listIntents({ workspaceRoot });
    if (res.ok) {
      set({ sessions: res.data });
    }
  },

  async selectSession(workspaceRoot, intentId) {
    set({ busy: true, busyLabel: "Loading intent session...", error: null });
    try {
      const res = await desktopApi.getIntent({ workspaceRoot, intentId });
      if (res.ok) {
        set({
          activeSession: res.data,
          selectedPatchId: res.data.patches[0]?.patchId ?? null,
          rollbackCheck: null
        });
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async createIntent(workspaceRoot, prompt) {
    set({ busy: true, busyLabel: "Understanding intent...", error: null });
    try {
      const res = await desktopApi.createIntent({ workspaceRoot, prompt });
      if (res.ok) {
        set({
          activeSession: res.data,
          activeTab: "intent",
          selectedPatchId: null,
          rollbackCheck: null
        });
        await get().loadSessions(workspaceRoot);
        return true;
      }
      set({ error: res.error.message });
      return false;
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async clarifyIntent(workspaceRoot, intentId, answers, confirmedCriteriaIds) {
    set({ busy: true, busyLabel: "Applying clarifications...", error: null });
    try {
      const res = await desktopApi.clarifyIntent({
        workspaceRoot,
        intentId,
        answers,
        confirmedCriteriaIds
      });
      if (res.ok) {
        set({ activeSession: res.data });
        await get().loadSessions(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async deleteIntent(workspaceRoot, intentId) {
    const res = await desktopApi.deleteIntent({ workspaceRoot, intentId });
    if (res.ok && res.data.deleted) {
      const current = get().activeSession;
      if (current?.intent.intentId === intentId) {
        set({ activeSession: null, selectedPatchId: null, rollbackCheck: null });
      }
      await get().loadSessions(workspaceRoot);
    }
  },

  async investigate(workspaceRoot, intentId) {
    set({ busy: true, busyLabel: "Investigating workspace files & API links...", error: null });
    try {
      const res = await desktopApi.investigateIntent({ workspaceRoot, intentId });
      if (res.ok) {
        set({ activeSession: res.data, activeTab: "investigate" });
        await get().loadSessions(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async analyze(workspaceRoot, intentId) {
    set({ busy: true, busyLabel: "Running evidence-based analysis...", error: null });
    try {
      const res = await desktopApi.analyzeIntent({ workspaceRoot, intentId });
      if (res.ok) {
        set({ activeSession: res.data, activeTab: "findings" });
        await get().loadSessions(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async recommend(workspaceRoot, intentId) {
    set({ busy: true, busyLabel: "Ranking engineering recommendations...", error: null });
    try {
      const res = await desktopApi.recommendIntent({ workspaceRoot, intentId });
      if (res.ok) {
        set({ activeSession: res.data, activeTab: "recommendations" });
        await get().loadSessions(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async decideRecommendation(workspaceRoot, intentId, recommendationId, decision) {
    const res = await desktopApi.decideRecommendation({
      workspaceRoot,
      intentId,
      recommendationId,
      decision
    });
    if (res.ok) {
      set({ activeSession: res.data });
    } else {
      set({ error: res.error.message });
    }
  },

  async generatePatch(workspaceRoot, intentId, recommendationIds, useAiGeneration = true) {
    set({ busy: true, busyLabel: "Generating validated patch proposals...", error: null });
    try {
      const res = await desktopApi.generateIntentPatch({
        workspaceRoot,
        intentId,
        recommendationIds,
        useAiGeneration
      });
      if (res.ok) {
        const newest = res.data.patches[res.data.patches.length - 1];
        set({
          activeSession: res.data,
          activeTab: "diff",
          selectedPatchId: newest?.patchId ?? null
        });
        await get().loadSessions(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async reviewPatches(workspaceRoot, intentId, patchIds, decision) {
    set({ busy: true, busyLabel: "Recording patch review decision...", error: null });
    try {
      const res = await desktopApi.reviewIntentPatch({
        workspaceRoot,
        intentId,
        patchIds,
        decision
      });
      if (res.ok) {
        set({ activeSession: res.data });
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async approveAndGetRecord(workspaceRoot, intentId, entries) {
    set({ busy: true, busyLabel: "Registering explicit transaction approval...", error: null });
    try {
      const res = await desktopApi.approvePatchTransaction({
        workspaceRoot,
        intentId,
        entries,
        approved: true
      });
      if (res.ok) {
        await get().selectSession(workspaceRoot, intentId);
        return res.data.approvalId;
      }
      set({ error: res.error.message });
      return null;
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async applyTransaction(workspaceRoot, intentId, approvalId) {
    set({ busy: true, busyLabel: "Applying approved patch transaction safely...", error: null });
    try {
      const res = await desktopApi.applyPatchTransaction({
        workspaceRoot,
        intentId,
        approvalId
      });
      if (res.ok) {
        await get().selectSession(workspaceRoot, intentId);
        await get().loadSessions(workspaceRoot);
        set({ activeTab: "verify" });
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async discoverVerification(workspaceRoot, intentId) {
    set({ busy: true, busyLabel: "Discovering project verification commands...", error: null });
    try {
      const res = await desktopApi.discoverVerificationCommands({ workspaceRoot, intentId });
      if (res.ok) {
        set({ verificationCommands: res.data });
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async runVerification(workspaceRoot, intentId, commandId, transactionId) {
    set({ busy: true, busyLabel: `Running approved command (${commandId})...`, error: null });
    try {
      const res = await desktopApi.runVerificationCommand({
        workspaceRoot,
        intentId,
        transactionId,
        commandId,
        approvedByUser: true
      });
      if (res.ok) {
        await get().selectSession(workspaceRoot, intentId);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async checkRollback(workspaceRoot, intentId, transactionId) {
    set({ busy: true, busyLabel: "Checking rollback safety and conflicts...", error: null });
    try {
      const res = await desktopApi.checkTransactionRollback({
        workspaceRoot,
        intentId,
        transactionId
      });
      if (res.ok) {
        set({ rollbackCheck: res.data });
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  },

  async executeRollback(
    workspaceRoot,
    intentId,
    transactionId,
    mode,
    targetFiles,
    forceOverwriteModified
  ) {
    set({ busy: true, busyLabel: "Restoring pre-change snapshot...", error: null });
    try {
      const res = await desktopApi.executeTransactionRollback({
        workspaceRoot,
        intentId,
        transactionId,
        mode,
        targetFiles,
        confirmedByUser: true,
        forceOverwriteModified
      });
      if (res.ok) {
        set({ rollbackCheck: null });
        await get().selectSession(workspaceRoot, intentId);
        await get().loadSessions(workspaceRoot);
      } else {
        set({ error: res.error.message });
      }
    } finally {
      set({ busy: false, busyLabel: null });
    }
  }
}));
