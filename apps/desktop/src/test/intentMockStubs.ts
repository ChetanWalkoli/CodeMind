import { vi } from "vitest";

const NOOP_ERR = { ok: false as const, error: { code: "NOOP", message: "noop" } };

export function createIntentBridgeStubs() {
  return {
    createIntent: vi.fn().mockResolvedValue(NOOP_ERR),
    listIntents: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    getIntent: vi.fn().mockResolvedValue(NOOP_ERR),
    clarifyIntent: vi.fn().mockResolvedValue(NOOP_ERR),
    cancelIntent: vi.fn().mockResolvedValue(NOOP_ERR),
    deleteIntent: vi.fn().mockResolvedValue({ ok: true as const, data: { deleted: true } }),
    investigateIntent: vi.fn().mockResolvedValue(NOOP_ERR),
    analyzeIntent: vi.fn().mockResolvedValue(NOOP_ERR),
    recommendIntent: vi.fn().mockResolvedValue(NOOP_ERR),
    decideRecommendation: vi.fn().mockResolvedValue(NOOP_ERR),
    generateIntentPatch: vi.fn().mockResolvedValue(NOOP_ERR),
    reviewIntentPatch: vi.fn().mockResolvedValue(NOOP_ERR),
    approvePatchTransaction: vi.fn().mockResolvedValue(NOOP_ERR),
    applyPatchTransaction: vi.fn().mockResolvedValue(NOOP_ERR),
    discoverVerificationCommands: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    runVerificationCommand: vi.fn().mockResolvedValue(NOOP_ERR),
    cancelVerificationCommand: vi
      .fn()
      .mockResolvedValue({ ok: true as const, data: { cancelled: false } }),
    checkTransactionRollback: vi.fn().mockResolvedValue(NOOP_ERR),
    executeTransactionRollback: vi.fn().mockResolvedValue(NOOP_ERR),
    createDecision: vi.fn().mockResolvedValue(NOOP_ERR),
    updateDecision: vi.fn().mockResolvedValue(NOOP_ERR),
    listDecisions: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    getDecision: vi.fn().mockResolvedValue(NOOP_ERR),
    deleteDecision: vi.fn().mockResolvedValue({ ok: true as const, data: { deleted: true } }),
    transitionDecisionStatus: vi.fn().mockResolvedValue(NOOP_ERR),
    createDecisionFromIntent: vi.fn().mockResolvedValue(NOOP_ERR),
    suggestDecisions: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    dismissDecisionSuggestion: vi
      .fn()
      .mockResolvedValue({ ok: true as const, data: { dismissed: true } }),
    linkDecisionEvidence: vi.fn().mockResolvedValue(NOOP_ERR),
    linkDecisionCommit: vi.fn().mockResolvedValue(NOOP_ERR),
    listDecisionGitCommits: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    getDecisionTimeline: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    searchDecisions: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    askWhyDecision: vi.fn().mockResolvedValue(NOOP_ERR),
    verifyAllDecisions: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    revalidateDecision: vi.fn().mockResolvedValue(NOOP_ERR),
    detectDecisionConflicts: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    analyzeChangeImpact: vi.fn().mockResolvedValue(NOOP_ERR),
    analyzeGitDiffImpact: vi.fn().mockResolvedValue(NOOP_ERR),
    getImpactAnalysis: vi.fn().mockResolvedValue(NOOP_ERR),
    listImpactAnalyses: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    checkImpactFreshness: vi.fn().mockResolvedValue(NOOP_ERR),
    updateImpactValidationStep: vi.fn().mockResolvedValue(NOOP_ERR),
    deleteImpactAnalysis: vi.fn().mockResolvedValue({ ok: true as const, data: { deleted: true } }),
    listActivityEvents: vi.fn().mockResolvedValue({ ok: true as const, data: [] }),
    clearActivityEvents: vi.fn().mockResolvedValue({ ok: true as const, data: { cleared: true } }),
    getAppPreferences: vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        schemaVersion: 1 as const,
        editorFontSize: 13,
        reopenLastWorkspace: true,
        onboardingCompleted: true,
        confirmBeforePatchApply: true,
        confirmBeforeCommandRun: true
      }
    }),
    updateAppPreferences: vi.fn().mockResolvedValue({
      ok: true as const,
      data: {
        schemaVersion: 1 as const,
        editorFontSize: 13,
        reopenLastWorkspace: true,
        onboardingCompleted: true,
        confirmBeforePatchApply: true,
        confirmBeforeCommandRun: true
      }
    }),
    getDiagnostics: vi.fn().mockResolvedValue(NOOP_ERR)
  };
}
