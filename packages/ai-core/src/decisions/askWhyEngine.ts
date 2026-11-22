import {
  AskWhyAnswerSchema,
  type AskWhyAnswer,
  type DecisionProvenance,
  type EngineeringDecision
} from "@codemind/shared";
import type { AIProvider } from "../types/ai.types.js";
import { searchDecisionsLocal } from "./decisionSearch.js";

export const NO_DECISION_HONEST_MESSAGE =
  "No recorded decision provides enough evidence to answer this question.";

/**
 * Deterministic local Ask Why engine (Milestone 7.8).
 * Works completely offline without Gemini. Produces a traceable, provenance-preserving
 * answer strictly from recorded decisions and validated evidence.
 */
export function answerAskWhyDeterministic(params: {
  question: string;
  decisions: readonly EngineeringDecision[];
  filePath?: string;
  symbolName?: string;
}): AskWhyAnswer {
  const effectiveQuery = [params.question, params.symbolName ?? ""].join(" ").trim();

  // First try file-scoped + question retrieval if filePath was supplied
  let matches = params.filePath
    ? searchDecisionsLocal({
        decisions: params.decisions,
        query: effectiveQuery,
        filePath: params.filePath,
        limit: 5
      })
    : [];

  // Fallback to workspace-wide decision search if file-scoped returned nothing
  if (matches.length === 0) {
    matches = searchDecisionsLocal({
      decisions: params.decisions,
      query: effectiveQuery,
      limit: 5
    });
  }

  // Require a meaningful score threshold so unrelated decisions are never fabricated as answers
  const strongMatches = matches.filter((m) => m.score >= 16);

  if (strongMatches.length === 0) {
    return AskWhyAnswerSchema.parse({
      question: params.question,
      answered: false,
      recordedDecision: NO_DECISION_HONEST_MESSAGE,
      reason: "No matching engineering decision record was found in this workspace.",
      alternatives: [],
      tradeoffs: [],
      evidence: [],
      gitReferences: [],
      matchedDecisionIds: [],
      relatedDecisionIds: [],
      confidence: "unknown",
      currentStatus: "unrecorded",
      verificationStatus: "unverified",
      usedAiSynthesis: false,
      honestNotice: NO_DECISION_HONEST_MESSAGE
    });
  }

  const primary = strongMatches[0]!.decision;
  const matchedIds = strongMatches.map((m) => m.decision.id);
  const relatedIds = Array.from(
    new Set([...primary.relatedDecisionIds, ...strongMatches.slice(1).map((m) => m.decision.id)])
  ).filter((id) => id !== primary.id);

  // Derive honest confidence from verification state & provenance
  let confidence: DecisionProvenance = primary.confidence;
  if (primary.verificationStatus === "stale" || primary.verificationStatus === "partially_stale") {
    confidence = "stale";
  } else if (
    primary.verificationStatus === "current" &&
    primary.evidence.some((e) => !e.isHistorical && e.provenance === "verified")
  ) {
    confidence = "verified";
  }

  const honestNotice =
    primary.verificationStatus === "stale" || primary.verificationStatus === "partially_stale"
      ? "Warning: One or more evidence links for this decision are stale because linked source files changed. Review and revalidate before relying on it."
      : primary.status === "superseded"
        ? `Note: This decision has been superseded${primary.supersededById ? ` by ${primary.supersededById}` : ""}.`
        : null;

  return AskWhyAnswerSchema.parse({
    question: params.question,
    answered: true,
    recordedDecision: primary.decision || primary.summary || primary.title,
    reason: primary.rationale || primary.problem || primary.context || "No rationale recorded yet.",
    alternatives: primary.alternatives,
    tradeoffs: primary.tradeoffs,
    evidence: primary.evidence,
    gitReferences: primary.gitReferences,
    matchedDecisionIds: matchedIds,
    relatedDecisionIds: relatedIds,
    confidence,
    currentStatus: primary.status,
    verificationStatus: primary.verificationStatus,
    usedAiSynthesis: false,
    honestNotice
  });
}

/**
 * Optional Gemini-assisted Ask Why synthesis (Milestone 7.8).
 * Sends ONLY the minimum matched decision records (never full database or secrets).
 * Strictly validates that AI-cited decisionIds and evidenceIds exist in the retrieved set,
 * rejects fabricated citations, and NEVER upgrades an AI interpretation to `verified`.
 */
export async function synthesizeAskWhyWithAI(params: {
  baseAnswer: AskWhyAnswer;
  matchedDecisions: readonly EngineeringDecision[];
  provider: AIProvider;
  model?: string;
  signal?: AbortSignal;
}): Promise<AskWhyAnswer> {
  if (!params.baseAnswer.answered || params.matchedDecisions.length === 0) {
    return params.baseAnswer;
  }

  const validDecisionIds = new Set(params.matchedDecisions.map((d) => d.id));
  const validEvidenceIds = new Set(
    params.matchedDecisions.flatMap((d) => d.evidence.map((e) => e.id))
  );

  const compactContext = params.matchedDecisions.slice(0, 3).map((d) => ({
    id: d.id,
    title: d.title,
    status: d.status,
    verificationStatus: d.verificationStatus,
    decision: d.decision,
    rationale: d.rationale,
    alternatives: d.alternatives.map((a) => ({
      name: a.name,
      status: a.evaluationStatus,
      rejectionReason: a.rejectionReason
    })),
    evidenceIds: d.evidence.map((e) => ({
      id: e.id,
      filePath: e.filePath,
      description: e.description
    }))
  }));

  const response = await params.provider.generate({
    model: params.model,
    responseFormat: "json",
    maxTokens: 768,
    signal: params.signal,
    messages: [
      {
        role: "system",
        content:
          'Synthesize a concise Ask Why explanation ONLY from the provided decision records. Return strict JSON: { "recordedDecision": string, "reason": string, "citedDecisionIds": string[], "citedEvidenceIds": string[] }. Never invent IDs, files, or historical facts.'
      },
      {
        role: "user",
        content: `Question: ${params.baseAnswer.question}\nRecords:\n${JSON.stringify(compactContext)}`
      }
    ]
  });

  try {
    const parsed = JSON.parse(response.content) as {
      recordedDecision?: string;
      reason?: string;
      citedDecisionIds?: string[];
      citedEvidenceIds?: string[];
    };

    const citedDecisions = Array.isArray(parsed.citedDecisionIds) ? parsed.citedDecisionIds : [];
    const citedEvidence = Array.isArray(parsed.citedEvidenceIds) ? parsed.citedEvidenceIds : [];

    // Reject fabricated decision IDs or evidence IDs!
    const hasFabricatedDecision = citedDecisions.some((id) => !validDecisionIds.has(id));
    const hasFabricatedEvidence = citedEvidence.some((id) => !validEvidenceIds.has(id));
    if (hasFabricatedDecision || hasFabricatedEvidence) {
      return {
        ...params.baseAnswer,
        honestNotice:
          "AI synthesis was discarded because it cited unverified decision or evidence references; showing deterministic record instead."
      };
    }

    // Never upgrade provenance to "verified" solely from AI synthesis
    const safeConfidence: DecisionProvenance =
      params.baseAnswer.confidence === "verified" ? "verified" : "inferred";

    return AskWhyAnswerSchema.parse({
      ...params.baseAnswer,
      recordedDecision: parsed.recordedDecision?.trim() || params.baseAnswer.recordedDecision,
      reason: parsed.reason?.trim() || params.baseAnswer.reason,
      confidence: safeConfidence,
      usedAiSynthesis: true
    });
  } catch {
    return params.baseAnswer;
  }
}
