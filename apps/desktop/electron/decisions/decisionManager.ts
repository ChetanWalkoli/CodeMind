import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  answerAskWhyDeterministic,
  assertDecisionStatusTransition,
  buildDecisionTimeline,
  computeDecisionVerificationState,
  detectDecisionConflictsLocal,
  searchDecisionsLocal,
  synthesizeAskWhyWithAI
} from "@codemind/ai-core";
import {
  DECISION_SCHEMA_VERSION,
  DecisionSuggestionSchema,
  EngineeringDecisionSchema,
  type AskWhyAnswer,
  type DecisionCategory,
  type DecisionConflict,
  type DecisionCreateFromIntentRequest,
  type DecisionCreateRequest,
  type DecisionGitReference,
  type DecisionLifecycleStatus,
  type DecisionLinkCommitRequest,
  type DecisionLinkEvidenceRequest,
  type DecisionRevalidateRequest,
  type DecisionSearchRequest,
  type DecisionSearchResult,
  type DecisionSuggestion,
  type DecisionTimelineEntry,
  type DecisionTimelineRequest,
  type DecisionTransitionStatusRequest,
  type DecisionUpdateRequest,
  type EngineeringDecision
} from "@codemind/shared";
import type { AIProviderManager } from "../ai/providerManager.js";
import type { IntentStore } from "../intent/intentStore.js";
import type { CodeEngineManager } from "../ipc/handlers/engine.handler.js";
import type { PreferencesStore } from "../utils/preferences.js";
import type { WorkspaceAuthority } from "../workspace/pathSecurity.js";
import { DecisionEvidenceService } from "./decisionEvidenceService.js";
import { listRecentGitCommits, resolveGitCommitReference } from "./decisionGitService.js";
import type { DecisionStore } from "./decisionStore.js";

function readInstalledPackages(workspaceRoot: string): string[] {
  const pkgPath = path.join(workspaceRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  } catch {
    return [];
  }
}

/**
 * Main-process Decision Memory Orchestrator (Phase 7: Milestones 7.1–7.9).
 * Reuses WorkspaceAuthority, ProjectIndexer, IntentStore, PreferencesStore,
 * and optional Phase 5 AIProviderManager. Never logs secrets, prompts, or source code.
 */
export class DecisionManager {
  private readonly authority: WorkspaceAuthority;
  private readonly store: DecisionStore;
  private readonly evidenceService: DecisionEvidenceService;
  private readonly engineManager: CodeEngineManager;
  private readonly preferences: PreferencesStore;
  private readonly intentStore?: IntentStore;
  private readonly providerManager?: AIProviderManager;

  constructor(deps: {
    authority: WorkspaceAuthority;
    store: DecisionStore;
    engineManager: CodeEngineManager;
    preferences: PreferencesStore;
    intentStore?: IntentStore;
    providerManager?: AIProviderManager;
  }) {
    this.authority = deps.authority;
    this.store = deps.store;
    this.evidenceService = new DecisionEvidenceService(deps.authority);
    this.engineManager = deps.engineManager;
    this.preferences = deps.preferences;
    this.intentStore = deps.intentStore;
    this.providerManager = deps.providerManager;
  }

  private getCustomExcludes(): string[] {
    return this.preferences.getWorkspaceSession().customExcludes;
  }

  private logEvent(action: string, metadata: Record<string, string | number | boolean>): void {
    console.info("[CodeMind DecisionMemory]", JSON.stringify({ action, ...metadata }));
  }

  // ---- 7.1 & 7.2 CRUD + Capture ----

  public async createDecision(req: DecisionCreateRequest): Promise<EngineeringDecision> {
    const realRoot = this.authority.getAuthorizedRoot(req.workspaceRoot);
    const now = new Date().toISOString();
    const indexer = this.engineManager.get(realRoot) ?? undefined;
    const customExcludes = this.getCustomExcludes();

    const evidence = (req.evidence ?? []).map((evInput) =>
      this.evidenceService.createValidatedEvidence({
        authorizedRoot: realRoot,
        input: evInput,
        indexer,
        customExcludes
      })
    );

    const gitReferences: DecisionGitReference[] = [];
    for (const sha of req.commitShas ?? []) {
      gitReferences.push(await resolveGitCommitReference(realRoot, sha));
    }

    const verificationStatus = computeDecisionVerificationState(req.status, evidence);
    const confidence =
      req.source === "ai_assisted_draft"
        ? "inferred"
        : evidence.some((e) => e.provenance === "verified")
          ? "verified"
          : "developer_stated";

    const id = `dec-${crypto.randomUUID().slice(0, 12)}`;
    const record = EngineeringDecisionSchema.parse({
      id,
      workspaceId: realRoot,
      title: req.title,
      summary: req.summary ?? "",
      context: req.context ?? "",
      problem: req.problem ?? "",
      decision: req.decision ?? "",
      rationale: req.rationale ?? "",
      status: req.status,
      category: req.category,
      createdAt: now,
      updatedAt: now,
      decidedAt: req.status === "accepted" ? now : null,
      createdBy: "developer",
      source: req.source,
      confidence,
      tags: req.tags ?? [],
      alternatives: req.alternatives ?? [],
      evidence,
      tradeoffs: req.tradeoffs ?? [],
      relatedDecisionIds: req.relatedDecisionIds ?? [],
      supersededById: null,
      relatedIntentId: req.relatedIntentId ?? null,
      gitReferences,
      verificationStatus,
      history: [
        {
          id: `hist-${crypto.randomUUID().slice(0, 10)}`,
          type: "created",
          summary: `Created ${req.category} decision (${req.status}).`,
          timestamp: now,
          actor: "developer"
        }
      ],
      schemaVersion: DECISION_SCHEMA_VERSION
    });

    const saved = this.store.upsertDecision(realRoot, record);
    this.logEvent("created", {
      decisionId: saved.id,
      category: saved.category,
      status: saved.status
    });
    return saved;
  }

  public updateDecision(req: DecisionUpdateRequest): EngineeringDecision {
    const realRoot = this.authority.getAuthorizedRoot(req.workspaceRoot);
    const existing = this.store.getDecision(realRoot, req.decisionId);
    if (!existing) {
      throw new Error(`Decision "${req.decisionId}" not found.`);
    }

    const now = new Date().toISOString();
    const updated = EngineeringDecisionSchema.parse({
      ...existing,
      title: req.title ?? existing.title,
      summary: req.summary ?? existing.summary,
      context: req.context ?? existing.context,
      problem: req.problem ?? existing.problem,
      decision: req.decision ?? existing.decision,
      rationale: req.rationale ?? existing.rationale,
      category: req.category ?? existing.category,
      tags: req.tags ?? existing.tags,
      alternatives: req.alternatives ?? existing.alternatives,
      tradeoffs: req.tradeoffs ?? existing.tradeoffs,
      relatedDecisionIds: req.relatedDecisionIds ?? existing.relatedDecisionIds,
      updatedAt: now,
      history: [
        ...existing.history.slice(-98),
        {
          id: `hist-${crypto.randomUUID().slice(0, 10)}`,
          type: "updated",
          summary: "Updated decision details, alternatives, or tradeoffs.",
          timestamp: now,
          actor: "developer"
        }
      ]
    });

    return this.store.upsertDecision(realRoot, updated);
  }

  public listDecisions(workspaceRoot: string): EngineeringDecision[] {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    return this.store.loadDecisions(realRoot);
  }

  public getDecision(workspaceRoot: string, decisionId: string): EngineeringDecision {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const found = this.store.getDecision(realRoot, decisionId);
    if (!found) throw new Error(`Decision "${decisionId}" not found.`);
    return found;
  }

  public deleteDecision(workspaceRoot: string, decisionId: string): boolean {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    return this.store.deleteDecision(realRoot, decisionId);
  }

  public transitionStatus(req: DecisionTransitionStatusRequest): EngineeringDecision {
    const realRoot = this.authority.getAuthorizedRoot(req.workspaceRoot);
    const existing = this.store.getDecision(realRoot, req.decisionId);
    if (!existing) throw new Error(`Decision "${req.decisionId}" not found.`);

    assertDecisionStatusTransition(existing.status, req.nextStatus);
    const now = new Date().toISOString();
    const eventTypeMap: Record<
      DecisionLifecycleStatus,
      "accepted" | "superseded" | "deprecated" | "rejected" | "updated"
    > = {
      accepted: "accepted",
      superseded: "superseded",
      deprecated: "deprecated",
      rejected: "rejected",
      proposed: "updated"
    };

    const nextVerification = computeDecisionVerificationState(req.nextStatus, existing.evidence);

    const updated = EngineeringDecisionSchema.parse({
      ...existing,
      status: req.nextStatus,
      decidedAt: req.nextStatus === "accepted" ? now : existing.decidedAt,
      supersededById:
        req.nextStatus === "superseded"
          ? (req.supersededById ?? existing.supersededById)
          : existing.supersededById,
      verificationStatus: nextVerification,
      updatedAt: now,
      history: [
        ...existing.history.slice(-98),
        {
          id: `hist-${crypto.randomUUID().slice(0, 10)}`,
          type: eventTypeMap[req.nextStatus],
          summary:
            req.note?.trim() ||
            `Transitioned decision status from ${existing.status} to ${req.nextStatus}.`,
          timestamp: now,
          actor: "developer"
        }
      ]
    });

    return this.store.upsertDecision(realRoot, updated);
  }

  // ---- 7.2 Capture from Phase 6 Intent Mode ----

  public async createDecisionFromIntent(
    req: DecisionCreateFromIntentRequest
  ): Promise<EngineeringDecision> {
    const realRoot = this.authority.getAuthorizedRoot(req.workspaceRoot);
    if (!this.intentStore) {
      throw new Error("Intent Mode store is not available.");
    }
    const session = this.intentStore.getSession(realRoot, req.intentId);
    if (!session) {
      throw new Error(`Intent session "${req.intentId}" not found.`);
    }

    const acceptedRecs = session.recommendations.filter(
      (r) => r.decision === "approved_for_patch" || r.decision === "selected"
    );
    const appliedFiles = Array.from(
      new Set(
        session.transactions.flatMap((tx) =>
          tx.files.filter((f) => f.status === "applied").map((f) => f.targetFile)
        )
      )
    );
    const evidenceFiles =
      appliedFiles.length > 0
        ? appliedFiles
        : (session.investigation?.relevantFiles.slice(0, 5).map((f) => f.filePath) ?? []);

    const categoryMap: Record<string, DecisionCategory> = {
      security: "security",
      performance: "performance",
      optimization: "performance",
      testing: "testing",
      architecture_change: "architecture"
    };
    const category: DecisionCategory = categoryMap[session.intent.intentType] ?? "architecture";

    return this.createDecision({
      workspaceRoot: realRoot,
      title: req.title?.trim() || `Decision: ${session.intent.normalizedGoal.slice(0, 140)}`,
      summary: session.analysis?.summary || session.intent.normalizedGoal,
      context: `Captured from Intent Mode session ${session.intent.intentId}.`,
      problem: session.intent.originalPrompt,
      decision: acceptedRecs.map((r) => r.title).join("; ") || session.intent.normalizedGoal,
      rationale:
        acceptedRecs.map((r) => r.rationale).join(" ") ||
        session.analysis?.summary ||
        "Captured from investigated intent workflow.",
      status: req.confirmAccepted ? "accepted" : "proposed",
      category,
      source: "intent_mode",
      tags: Array.from(new Set([session.intent.intentType, ...session.intent.affectedAreas])).slice(
        0,
        10
      ),
      evidence: evidenceFiles.map((fp) => ({
        type: "source_file" as const,
        filePath: fp,
        description: `Linked from Intent session ${session.intent.intentId}`
      })),
      relatedIntentId: session.intent.intentId
    });
  }

  // ---- 7.2 Deterministic Local Suggestions ----

  public suggestDecisions(workspaceRoot: string): DecisionSuggestion[] {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const existingSuggestions = this.store.loadSuggestions(realRoot);
    const dismissedIds = new Set(existingSuggestions.filter((s) => s.dismissed).map((s) => s.id));
    const existingDecisions = this.store.loadDecisions(realRoot);
    const recordedIntentIds = new Set(
      existingDecisions.map((d) => d.relatedIntentId).filter((id): id is string => Boolean(id))
    );

    const suggestions: DecisionSuggestion[] = [];
    const now = new Date().toISOString();

    // Signal 1: Completed Intent Mode sessions without a Decision Memory record yet
    if (this.intentStore) {
      for (const summary of this.intentStore.listSessions(realRoot)) {
        if (summary.status !== "completed" || recordedIntentIds.has(summary.intentId)) continue;
        const id = `sug-intent-${summary.intentId.slice(0, 12)}`;
        if (dismissedIds.has(id)) continue;
        suggestions.push(
          DecisionSuggestionSchema.parse({
            id,
            workspaceId: realRoot,
            title: `Document decision for: ${summary.normalizedGoal.slice(0, 100)}`,
            summary: `Completed ${summary.intentType} intent with ${summary.transactionCount} applied transaction(s).`,
            category: summary.intentType === "security" ? "security" : "architecture",
            signalType: "intent_session",
            reason: "Completed Intent Mode change has no recorded engineering decision yet.",
            relatedFiles: [],
            relatedIntentId: summary.intentId,
            dismissed: false,
            convertedDecisionId: null,
            detectedAt: now
          })
        );
      }
    }

    // Signal 2: Auth / security / API architectural files present without an auth decision
    const indexer = this.engineManager.get(realRoot) ?? undefined;
    const hasAuthDecision = existingDecisions.some((d) => d.category === "authentication");
    if (indexer && !hasAuthDecision) {
      const authFiles = indexer
        .getAllFilePaths()
        .filter((p) => /(?:^|\/)(?:auth|jwt|oauth|session)/i.test(p))
        .slice(0, 4);
      if (authFiles.length > 0) {
        const id = "sug-auth-strategy";
        if (!dismissedIds.has(id)) {
          suggestions.push(
            DecisionSuggestionSchema.parse({
              id,
              workspaceId: realRoot,
              title: "Document authentication strategy",
              summary: `Detected ${authFiles.length} authentication-related module(s) with no recorded authentication decision.`,
              category: "authentication",
              signalType: "auth_strategy",
              reason: "Authentication implementation files exist without an ADR/decision record.",
              relatedFiles: authFiles,
              relatedIntentId: null,
              dismissed: false,
              convertedDecisionId: null,
              detectedAt: now
            })
          );
        }
      }
    }

    // Signal 3: Notable framework/DB dependencies in package.json without a dependencies decision
    const installed = readInstalledPackages(realRoot);
    const notable = installed.filter((pkg) =>
      /^(?:@google\/genai|prisma|@prisma\/client|zustand|express|next|jsonwebtoken|zod)$/i.test(pkg)
    );
    const hasDepDecision = existingDecisions.some((d) => d.category === "dependencies");
    if (notable.length > 0 && !hasDepDecision) {
      const id = "sug-key-dependencies";
      if (!dismissedIds.has(id)) {
        suggestions.push(
          DecisionSuggestionSchema.parse({
            id,
            workspaceId: realRoot,
            title: `Document core dependency choices (${notable.slice(0, 3).join(", ")})`,
            summary: `Found ${notable.length} key architectural dependency(ies) in package.json.`,
            category: "dependencies",
            signalType: "dependency_change",
            reason: "Significant core dependencies have no documented rationale or alternatives.",
            relatedFiles: ["package.json"],
            relatedIntentId: null,
            dismissed: false,
            convertedDecisionId: null,
            detectedAt: now
          })
        );
      }
    }

    this.store.saveSuggestions(realRoot, [
      ...existingSuggestions.filter((s) => s.dismissed),
      ...suggestions
    ]);
    return suggestions;
  }

  public dismissSuggestion(workspaceRoot: string, suggestionId: string): boolean {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const list = this.store.loadSuggestions(realRoot);
    const updated = list.map((s) => (s.id === suggestionId ? { ...s, dismissed: true } : s));
    this.store.saveSuggestions(realRoot, updated);
    return true;
  }

  // ---- 7.3 & 7.5 Evidence & Git Commit Linking ----

  public linkEvidence(req: DecisionLinkEvidenceRequest): EngineeringDecision {
    const realRoot = this.authority.getAuthorizedRoot(req.workspaceRoot);
    const existing = this.store.getDecision(realRoot, req.decisionId);
    if (!existing) throw new Error(`Decision "${req.decisionId}" not found.`);

    const ev = this.evidenceService.createValidatedEvidence({
      authorizedRoot: realRoot,
      input: req.evidence,
      indexer: this.engineManager.get(realRoot) ?? undefined,
      customExcludes: this.getCustomExcludes()
    });

    const nextEvidence = [...existing.evidence, ev];
    const nextVerification = computeDecisionVerificationState(existing.status, nextEvidence);

    return this.store.upsertDecision(realRoot, {
      ...existing,
      evidence: nextEvidence,
      verificationStatus: nextVerification,
      confidence: ev.provenance === "verified" ? "verified" : existing.confidence,
      updatedAt: new Date().toISOString()
    });
  }

  public async linkCommit(req: DecisionLinkCommitRequest): Promise<EngineeringDecision> {
    const realRoot = this.authority.getAuthorizedRoot(req.workspaceRoot);
    const existing = this.store.getDecision(realRoot, req.decisionId);
    if (!existing) throw new Error(`Decision "${req.decisionId}" not found.`);

    const gitRef = await resolveGitCommitReference(realRoot, req.commitSha);
    const deduped = [
      gitRef,
      ...existing.gitReferences.filter((g) => g.commitSha !== gitRef.commitSha)
    ];

    const now = new Date().toISOString();
    return this.store.upsertDecision(realRoot, {
      ...existing,
      gitReferences: deduped,
      updatedAt: now,
      history: [
        ...existing.history.slice(-98),
        {
          id: `hist-${crypto.randomUUID().slice(0, 10)}`,
          type: "commit_linked",
          summary: `Linked Git commit ${gitRef.shortSha}: ${gitRef.message}`,
          timestamp: now,
          actor: "developer"
        }
      ]
    });
  }

  public async listGitCommits(workspaceRoot: string, limit = 20): Promise<DecisionGitReference[]> {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    return listRecentGitCommits(realRoot, limit);
  }

  // ---- 7.6 Timeline & 7.7 Search ----

  public getTimeline(req: DecisionTimelineRequest): DecisionTimelineEntry[] {
    const realRoot = this.authority.getAuthorizedRoot(req.workspaceRoot);
    return buildDecisionTimeline({
      decisions: this.store.loadDecisions(realRoot),
      order: req.order,
      category: req.category,
      status: req.status,
      tag: req.tag,
      query: req.query
    });
  }

  public searchDecisions(req: DecisionSearchRequest): DecisionSearchResult[] {
    const realRoot = this.authority.getAuthorizedRoot(req.workspaceRoot);
    return searchDecisionsLocal({
      decisions: this.store.loadDecisions(realRoot),
      query: req.query,
      category: req.category,
      status: req.status,
      tag: req.tag,
      filePath: req.filePath,
      commitSha: req.commitSha,
      onlyStale: req.onlyStale,
      limit: req.limit
    });
  }

  // ---- 7.8 Ask Why ----

  public async askWhy(params: {
    workspaceRoot: string;
    question: string;
    filePath?: string;
    symbolName?: string;
    useAiSynthesis?: boolean;
  }): Promise<AskWhyAnswer> {
    const realRoot = this.authority.getAuthorizedRoot(params.workspaceRoot);
    const verified = this.verifyAllDecisions(realRoot);

    const baseAnswer = answerAskWhyDeterministic({
      question: params.question,
      decisions: verified,
      filePath: params.filePath,
      symbolName: params.symbolName
    });

    if (params.useAiSynthesis && baseAnswer.answered && this.providerManager) {
      try {
        const provider = this.providerManager.getProvider("gemini");
        const model = this.preferences.getAISettings().model;
        const matched = verified.filter((d) => baseAnswer.matchedDecisionIds.includes(d.id));
        return await synthesizeAskWhyWithAI({
          baseAnswer,
          matchedDecisions: matched,
          provider,
          model
        });
      } catch {
        return baseAnswer;
      }
    }

    return baseAnswer;
  }

  // ---- 7.9 Verification, Revalidation & Conflict Detection ----

  public verifyAllDecisions(workspaceRoot: string): EngineeringDecision[] {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const decisions = this.store.loadDecisions(realRoot);
    const indexer = this.engineManager.get(realRoot) ?? undefined;

    let changed = false;
    const verified = decisions.map((d) => {
      const res = this.evidenceService.verifyDecisionEvidence({
        authorizedRoot: realRoot,
        decision: d,
        indexer
      });
      if (res.newlyStaleCount > 0 || res.decision.verificationStatus !== d.verificationStatus) {
        changed = true;
      }
      return res.decision;
    });

    if (changed) {
      this.store.saveDecisions(realRoot, verified);
    }
    return verified;
  }

  public revalidateDecision(req: DecisionRevalidateRequest): EngineeringDecision {
    const realRoot = this.authority.getAuthorizedRoot(req.workspaceRoot);
    const existing = this.store.getDecision(realRoot, req.decisionId);
    if (!existing) throw new Error(`Decision "${req.decisionId}" not found.`);

    const revalidated = this.evidenceService.revalidateDecisionEvidence({
      authorizedRoot: realRoot,
      decision: existing
    });

    const finalRecord = EngineeringDecisionSchema.parse({
      ...revalidated,
      rationale: req.updatedRationale?.trim() || revalidated.rationale
    });
    return this.store.upsertDecision(realRoot, finalRecord);
  }

  public detectConflicts(workspaceRoot: string): DecisionConflict[] {
    const realRoot = this.authority.getAuthorizedRoot(workspaceRoot);
    const decisions = this.store.loadDecisions(realRoot);
    const installedPackages = readInstalledPackages(realRoot);
    return detectDecisionConflictsLocal({ decisions, installedPackages });
  }
}
