import crypto from "node:crypto";
import {
  applyIntentClarifications,
  assertIntentStatusTransition,
  generateDeterministicRecommendations,
  parseIntentDeterministic,
  refineAmbiguousIntentWithAI,
  runDeterministicAnalysis
} from "@codemind/ai-core";
import type {
  IntentSession,
  IntentSessionSummary,
  IntentStatus,
  InvestigationLimits,
  PatchApprovalEntry,
  PatchApprovalRecord,
  PatchReviewDecision,
  PatchTransactionRecord,
  RecommendationDecision,
  RollbackCheckResult,
  RollbackMode,
  RollbackRecord,
  VerificationCandidateCommand,
  VerificationRunRecord
} from "@codemind/shared";
import type { AIProviderManager } from "../ai/providerManager.js";
import type { CodeEngineManager } from "../ipc/handlers/engine.handler.js";
import type { PreferencesStore } from "../utils/preferences.js";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";
import type { IntentStore } from "./intentStore.js";
import { InvestigationEngine } from "./investigationEngine.js";
import { PatchApplicationEngine, type AtomicWriteFileFn } from "./patchApplicationEngine.js";
import { PatchService } from "./patchService.js";
import { RecoveryManager } from "./recoveryManager.js";
import { VerificationEngine } from "./verificationEngine.js";

export interface IntentDiagnosticEntry {
  operationId: string;
  intentId: string;
  stage: string;
  durationMs: number;
  outcome: "ok" | "error";
  metadata: Record<string, string | number | boolean | null>;
}

/**
 * Unified Phase 6 Intent Mode Orchestrator (Milestones 6.1–6.9).
 * Enforces status transitions, workspace authorization, deterministic validation,
 * privacy-safe diagnostics, and incremental re-indexing after applied patches or rollbacks.
 */
export class IntentOrchestrator {
  private readonly authority: WorkspaceAuthority;
  private readonly preferences: PreferencesStore;
  private readonly engineManager: CodeEngineManager;
  private readonly providerManager?: AIProviderManager;
  private readonly store: IntentStore;
  private readonly investigationEngine: InvestigationEngine;
  private readonly patchService: PatchService;
  private readonly applicationEngine: PatchApplicationEngine;
  private readonly verificationEngine: VerificationEngine;
  private readonly recoveryManager: RecoveryManager;
  private readonly logDiagnostic: (entry: IntentDiagnosticEntry) => void;

  constructor(deps: {
    authority: WorkspaceAuthority;
    preferences: PreferencesStore;
    engineManager: CodeEngineManager;
    providerManager?: AIProviderManager;
    store: IntentStore;
    writeFileAtomic?: AtomicWriteFileFn;
    onDiagnostic?: (entry: IntentDiagnosticEntry) => void;
  }) {
    this.authority = deps.authority;
    this.preferences = deps.preferences;
    this.engineManager = deps.engineManager;
    this.providerManager = deps.providerManager;
    this.store = deps.store;
    this.investigationEngine = new InvestigationEngine(deps.authority);
    this.patchService = new PatchService({
      authority: deps.authority,
      providerManager: deps.providerManager
    });
    this.applicationEngine = new PatchApplicationEngine({
      authority: deps.authority,
      store: deps.store,
      writeFileAtomic: deps.writeFileAtomic
    });
    this.verificationEngine = new VerificationEngine(deps.authority);
    this.recoveryManager = new RecoveryManager({
      authority: deps.authority,
      store: deps.store
    });
    this.logDiagnostic =
      deps.onDiagnostic ??
      ((entry) => {
        console.info("[CodeMind Intent]", JSON.stringify(entry));
      });
  }

  private getSessionOrThrow(authorizedRoot: string, intentId: string): IntentSession {
    const session = this.store.getSession(authorizedRoot, intentId);
    if (!session) {
      throw new Error(`Intent session "${intentId}" was not found.`);
    }
    return session;
  }

  private transitionStatus(session: IntentSession, nextStatus: IntentStatus): IntentSession {
    assertIntentStatusTransition(session.intent.status, nextStatus);
    return {
      ...session,
      intent: {
        ...session.intent,
        status: nextStatus,
        updatedAt: new Date().toISOString()
      }
    };
  }

  // ---- 6.1 Intent Understanding ----

  public async createIntent(params: {
    workspaceRoot: string;
    prompt: string;
    useAiRefinement?: boolean;
  }): Promise<IntentSession> {
    const startedAt = Date.now();
    const opId = crypto.randomUUID().slice(0, 10);
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);

    let intent = parseIntentDeterministic({
      workspaceId: realRoot,
      prompt: params.prompt
    });

    if (intent.ambiguity.isAmbiguous && params.useAiRefinement && this.providerManager) {
      try {
        const provider = this.providerManager.getProvider("gemini");
        const model = this.preferences.getAISettings().model;
        intent = await refineAmbiguousIntentWithAI({ intent, provider, model });
      } catch {
        // Fall back safely to deterministic clarification questions
      }
    }

    let session: IntentSession = {
      intent,
      investigation: null,
      analysis: null,
      recommendations: [],
      patches: [],
      approvals: [],
      transactions: [],
      verifications: [],
      rollbacks: [],
      auditEvents: []
    };

    session = this.store.appendAuditEvent(
      realRoot,
      session,
      "6.1:intent",
      "created",
      `Parsed ${intent.intentType} intent (${intent.status}).`
    );

    this.logDiagnostic({
      operationId: opId,
      intentId: intent.intentId,
      stage: "intent_create",
      durationMs: Date.now() - startedAt,
      outcome: "ok",
      metadata: {
        intentType: intent.intentType,
        status: intent.status,
        ambiguous: intent.ambiguity.isAmbiguous
      }
    });

    return session;
  }

  public listIntents(workspaceRoot: string): IntentSessionSummary[] {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    return this.store.listSessions(realRoot);
  }

  public getIntent(workspaceRoot: string, intentId: string): IntentSession {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const session = this.getSessionOrThrow(realRoot, intentId);
    if (session.patches.length > 0) {
      const refreshed = this.patchService.refreshPatchStaleness(realRoot, session.patches);
      return { ...session, patches: refreshed };
    }
    return session;
  }

  public clarifyIntent(params: {
    workspaceRoot: string;
    intentId: string;
    answers: Record<string, string>;
    confirmedCriteriaIds?: string[];
  }): IntentSession {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    const session = this.getSessionOrThrow(realRoot, params.intentId);
    const updatedIntent = applyIntentClarifications(
      session.intent,
      params.answers,
      params.confirmedCriteriaIds
    );
    assertIntentStatusTransition(session.intent.status, updatedIntent.status);
    const next: IntentSession = { ...session, intent: updatedIntent };
    return this.store.appendAuditEvent(
      realRoot,
      next,
      "6.1:intent",
      "clarified",
      `Clarification applied; status is now ${updatedIntent.status}.`
    );
  }

  public cancelIntent(workspaceRoot: string, intentId: string): IntentSession {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    let session = this.getSessionOrThrow(realRoot, intentId);
    session = this.transitionStatus(session, "cancelled");
    return this.store.appendAuditEvent(
      realRoot,
      session,
      "6.1:intent",
      "cancelled",
      "Intent session cancelled by user."
    );
  }

  public deleteIntent(workspaceRoot: string, intentId: string): boolean {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    return this.store.deleteSession(realRoot, intentId);
  }

  // ---- 6.2 Codebase Investigation ----

  public async investigateIntent(params: {
    workspaceRoot: string;
    intentId: string;
    limits?: Partial<InvestigationLimits>;
  }): Promise<IntentSession> {
    const startedAt = Date.now();
    const opId = crypto.randomUUID().slice(0, 10);
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    let session = this.getSessionOrThrow(realRoot, params.intentId);

    session = this.transitionStatus(session, "investigating");
    this.store.saveSession(realRoot, session);

    try {
      const customExcludes = this.preferences.getWorkspaceSession().customExcludes;
      let indexer = this.engineManager.get(realRoot);
      if (!indexer) {
        indexer = this.engineManager.getOrCreate(realRoot, customExcludes);
        await indexer.indexWorkspace();
      }

      const report = this.investigationEngine.investigate({
        authorizedRoot: realRoot,
        indexer,
        intent: session.intent,
        customExcludes,
        limits: params.limits
      });

      session = this.transitionStatus({ ...session, investigation: report }, "analyzing");
      session = this.store.appendAuditEvent(
        realRoot,
        session,
        "6.2:investigation",
        "completed",
        `Investigated ${report.relevantFiles.length} file(s), ${report.relevantSymbols.length} symbol(s), and ${report.apiRelationships.length} API link(s).`
      );

      this.logDiagnostic({
        operationId: opId,
        intentId: session.intent.intentId,
        stage: "investigation",
        durationMs: Date.now() - startedAt,
        outcome: "ok",
        metadata: {
          files: report.relevantFiles.length,
          symbols: report.relevantSymbols.length,
          apiLinks: report.apiRelationships.length,
          bytesInspected: report.totalBytesInspected
        }
      });

      return session;
    } catch (err) {
      const failed = this.transitionStatus(session, "failed");
      this.store.saveSession(realRoot, failed);
      throw err;
    }
  }

  // ---- 6.3 Evidence-Based Analysis ----

  public analyzeIntent(params: {
    workspaceRoot: string;
    intentId: string;
    useAiReasoning?: boolean;
  }): IntentSession {
    const startedAt = Date.now();
    const opId = crypto.randomUUID().slice(0, 10);
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    let session = this.getSessionOrThrow(realRoot, params.intentId);

    const investigation = session.investigation;
    if (!investigation) {
      throw new Error("Run codebase investigation before analysis.");
    }

    if (session.intent.status !== "analyzing") {
      session = this.transitionStatus(session, "analyzing");
    }

    const analysis = runDeterministicAnalysis({
      intent: session.intent,
      investigation,
      usedAiReasoning: false
    });

    session = this.transitionStatus({ ...session, analysis }, "awaiting_review");
    session = this.store.appendAuditEvent(
      realRoot,
      session,
      "6.3:analysis",
      "completed",
      `Produced ${analysis.findings.length} finding(s) and ${analysis.contradictions.length} contradiction(s).`
    );

    this.logDiagnostic({
      operationId: opId,
      intentId: session.intent.intentId,
      stage: "analysis",
      durationMs: Date.now() - startedAt,
      outcome: "ok",
      metadata: {
        findings: analysis.findings.length,
        contradictions: analysis.contradictions.length
      }
    });

    return session;
  }

  // ---- 6.4 Recommendation Engine ----

  public recommendIntent(workspaceRoot: string, intentId: string): IntentSession {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    let session = this.getSessionOrThrow(realRoot, intentId);
    if (!session.analysis) {
      throw new Error("Run evidence-based analysis before generating recommendations.");
    }

    const recommendations = generateDeterministicRecommendations({
      intent: session.intent,
      analysis: session.analysis
    });

    session = { ...session, recommendations };
    return this.store.appendAuditEvent(
      realRoot,
      session,
      "6.4:recommendations",
      "generated",
      `Ranked ${recommendations.length} evidence-backed recommendation(s).`
    );
  }

  public decideRecommendation(params: {
    workspaceRoot: string;
    intentId: string;
    recommendationId: string;
    decision: RecommendationDecision;
    note?: string;
  }): IntentSession {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    const session = this.getSessionOrThrow(realRoot, params.intentId);

    let found = false;
    const updatedRecs = session.recommendations.map((rec) => {
      if (rec.recommendationId !== params.recommendationId) return rec;
      found = true;
      return {
        ...rec,
        decision: params.decision,
        decisionNote: params.note ?? rec.decisionNote
      };
    });

    if (!found) {
      throw new Error(`Recommendation "${params.recommendationId}" not found.`);
    }

    const next: IntentSession = { ...session, recommendations: updatedRecs };
    return this.store.appendAuditEvent(
      realRoot,
      next,
      "6.4:recommendations",
      "decision",
      `Recommendation ${params.recommendationId} marked as ${params.decision}.`
    );
  }

  // ---- 6.5 & 6.6 Patch Generation & Diff Review ----

  public async generatePatch(params: {
    workspaceRoot: string;
    intentId: string;
    recommendationIds: string[];
    useAiGeneration?: boolean;
    proposedEdits?: Array<{ targetFile: string; proposedContent: string; summary?: string }>;
  }): Promise<IntentSession> {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    const session = this.getSessionOrThrow(realRoot, params.intentId);
    const customExcludes = this.preferences.getWorkspaceSession().customExcludes;
    const modelId = this.preferences.getAISettings().model;

    const newProposals = await this.patchService.generateProposals({
      authorizedRoot: realRoot,
      session,
      recommendationIds: params.recommendationIds,
      customExcludes,
      useAiGeneration: params.useAiGeneration,
      modelId,
      proposedEdits: params.proposedEdits
    });

    const next: IntentSession = {
      ...session,
      patches: [...session.patches, ...newProposals]
    };

    return this.store.appendAuditEvent(
      realRoot,
      next,
      "6.5:patch",
      "generated",
      `Generated ${newProposals.length} validated patch proposal(s) without modifying workspace files.`
    );
  }

  public reviewPatch(params: {
    workspaceRoot: string;
    intentId: string;
    patchIds: string[];
    decision: PatchReviewDecision;
  }): IntentSession {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    const session = this.getSessionOrThrow(realRoot, params.intentId);
    const targetSet = new Set(params.patchIds);

    const updatedPatches = session.patches.map((patch) => {
      if (!targetSet.has(patch.patchId)) return patch;
      if (params.decision === "accepted" && !patch.validation.valid) {
        throw new Error(`Cannot accept invalid patch "${patch.patchId}".`);
      }
      return { ...patch, reviewDecision: params.decision };
    });

    const next: IntentSession = { ...session, patches: updatedPatches };
    return this.store.appendAuditEvent(
      realRoot,
      next,
      "6.6:review",
      "reviewed",
      `Marked ${params.patchIds.length} patch(es) as ${params.decision} (no files modified).`
    );
  }

  // ---- 6.7 Approval & Safe Patch Application ----

  public approvePatchTransaction(params: {
    workspaceRoot: string;
    intentId: string;
    entries: PatchApprovalEntry[];
    approved: boolean;
  }): PatchApprovalRecord {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    let session = this.getSessionOrThrow(realRoot, params.intentId);

    const record = this.applicationEngine.createApproval({
      authorizedRoot: realRoot,
      session,
      entries: params.entries,
      approved: params.approved
    });

    session = {
      ...session,
      approvals: [...session.approvals, record]
    };
    if (record.approved && session.intent.status === "awaiting_review") {
      session = this.transitionStatus(session, "approved");
    }

    this.store.appendAuditEvent(
      realRoot,
      session,
      "6.7:approval",
      record.approved ? "approved" : "revoked",
      `Transaction approval ${record.approvalId} recorded for ${record.entries.length} file(s).`
    );

    return record;
  }

  public async applyPatchTransaction(params: {
    workspaceRoot: string;
    intentId: string;
    approvalId: string;
  }): Promise<PatchTransactionRecord> {
    const startedAt = Date.now();
    const opId = crypto.randomUUID().slice(0, 10);
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    let session = this.getSessionOrThrow(realRoot, params.intentId);
    const customExcludes = this.preferences.getWorkspaceSession().customExcludes;

    const tx = this.applicationEngine.applyApprovedTransaction({
      authorizedRoot: realRoot,
      session,
      approvalId: params.approvalId,
      customExcludes
    });

    session = {
      ...session,
      transactions: [...session.transactions, tx]
    };
    if (tx.status === "applied" && session.intent.status === "approved") {
      session = this.transitionStatus(session, "completed");
    }

    this.store.appendAuditEvent(
      realRoot,
      session,
      "6.7:apply",
      tx.status,
      `Patch transaction ${tx.transactionId} finished with status "${tx.status}".`
    );

    // Incrementally notify code engine of modified files
    for (const file of tx.files) {
      if (file.status === "applied") {
        await this.engineManager.notifyFileSaved(realRoot, file.targetFile);
      }
    }

    this.logDiagnostic({
      operationId: opId,
      intentId: session.intent.intentId,
      stage: "patch_apply",
      durationMs: Date.now() - startedAt,
      outcome: tx.status === "applied" ? "ok" : "error",
      metadata: {
        transactionId: tx.transactionId,
        status: tx.status,
        fileCount: tx.files.length
      }
    });

    return tx;
  }

  // ---- 6.8 Verification Engine ----

  public discoverVerificationCommands(workspaceRoot: string): VerificationCandidateCommand[] {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    return this.verificationEngine.discoverCommands(realRoot);
  }

  public async runVerificationCommand(params: {
    workspaceRoot: string;
    intentId: string;
    transactionId?: string;
    commandId: string;
    approvedByUser: boolean;
    timeoutMs?: number;
  }): Promise<VerificationRunRecord> {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    const session = this.getSessionOrThrow(realRoot, params.intentId);

    const run = await this.verificationEngine.runApprovedCommand({
      authorizedRoot: realRoot,
      intentId: params.intentId,
      transactionId: params.transactionId,
      commandId: params.commandId,
      approvedByUser: params.approvedByUser,
      timeoutMs: params.timeoutMs
    });

    const next: IntentSession = {
      ...session,
      verifications: [...session.verifications, run]
    };
    this.store.appendAuditEvent(
      realRoot,
      next,
      "6.8:verification",
      run.status,
      `Verification "${run.displayCommand}" finished with status "${run.status}" (exit ${run.exitCode ?? "n/a"}).`
    );

    return run;
  }

  public cancelVerificationCommand(verificationId: string): boolean {
    return this.verificationEngine.cancel(verificationId);
  }

  // ---- 6.9 Rollback & Recovery ----

  public checkTransactionRollback(params: {
    workspaceRoot: string;
    intentId: string;
    transactionId: string;
    targetFiles?: string[];
  }): RollbackCheckResult {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    const session = this.getSessionOrThrow(realRoot, params.intentId);
    return this.recoveryManager.checkRollback({
      authorizedRoot: realRoot,
      session,
      transactionId: params.transactionId,
      targetFiles: params.targetFiles
    });
  }

  public async executeTransactionRollback(params: {
    workspaceRoot: string;
    intentId: string;
    transactionId: string;
    mode: RollbackMode;
    targetFiles?: string[];
    confirmedByUser: boolean;
    forceOverwriteModified?: boolean;
  }): Promise<RollbackRecord> {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    const session = this.getSessionOrThrow(realRoot, params.intentId);

    const record = this.recoveryManager.executeRollback({
      authorizedRoot: realRoot,
      session,
      transactionId: params.transactionId,
      mode: params.mode,
      targetFiles: params.targetFiles,
      confirmedByUser: params.confirmedByUser,
      forceOverwriteModified: params.forceOverwriteModified
    });

    const updatedTransactions = session.transactions.map((tx) =>
      tx.transactionId === params.transactionId &&
      params.mode === "full-transaction" &&
      record.status === "completed"
        ? { ...tx, status: "rolled_back" as const }
        : tx
    );

    const next: IntentSession = {
      ...session,
      transactions: updatedTransactions,
      rollbacks: [...session.rollbacks, record]
    };
    this.store.appendAuditEvent(
      realRoot,
      next,
      "6.9:rollback",
      record.status,
      `Rollback ${record.rollbackId} (${record.mode}) finished with status "${record.status}".`
    );

    for (const f of record.files) {
      if (f.status === "restored") {
        await this.engineManager.notifyFileSaved(realRoot, f.targetFile);
      }
    }

    return record;
  }
}
