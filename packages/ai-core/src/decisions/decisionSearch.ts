import type {
  DecisionCategory,
  DecisionLifecycleStatus,
  DecisionSearchResult,
  DecisionTimelineEntry,
  EngineeringDecision
} from "@codemind/shared";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "are",
  "was",
  "were",
  "does",
  "why",
  "what",
  "which",
  "how",
  "use",
  "using",
  "used",
  "project",
  "have",
  "has",
  "been",
  "about",
  "here",
  "our",
  "your"
]);

function tokenize(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function boundedEditDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else {
      edits += 1;
      if (edits > 1) return false;
      if (a.length > b.length) i += 1;
      else if (b.length > a.length) j += 1;
      else {
        i += 1;
        j += 1;
      }
    }
  }
  if (i < a.length || j < b.length) edits += 1;
  return edits <= 1;
}

export interface LocalDecisionSearchParams {
  decisions: readonly EngineeringDecision[];
  query?: string;
  category?: DecisionCategory;
  status?: DecisionLifecycleStatus;
  tag?: string;
  filePath?: string;
  commitSha?: string;
  onlyStale?: boolean;
  limit?: number;
}

/**
 * Deterministic local decision retrieval & ranking (Milestone 7.7).
 * Never calls Gemini. Scores exact title > tag/category > tokenized keyword >
 * file/symbol/commit match > related decision > conservative fuzzy match.
 */
export function searchDecisionsLocal(params: LocalDecisionSearchParams): DecisionSearchResult[] {
  const query = (params.query ?? "").trim();
  const queryLower = query.toLowerCase();
  const queryTerms = tokenize(query);
  const filePathLower = params.filePath?.replace(/\\/g, "/").toLowerCase();
  const commitLower = params.commitSha?.toLowerCase();
  const tagLower = params.tag?.toLowerCase();
  const limit = params.limit ?? 20;

  const results: DecisionSearchResult[] = [];

  for (const decision of params.decisions) {
    if (params.category && decision.category !== params.category) continue;
    if (params.status && decision.status !== params.status) continue;
    if (tagLower && !decision.tags.some((t) => t.toLowerCase() === tagLower)) continue;
    if (
      params.onlyStale &&
      decision.verificationStatus !== "stale" &&
      decision.verificationStatus !== "partially_stale"
    ) {
      continue;
    }

    let score = 0;
    const reasons = new Set<string>();
    const matchedEvidenceIds = new Set<string>();

    // File path filter / boost
    if (filePathLower) {
      const matchedEv = decision.evidence.filter(
        (e) =>
          e.filePath &&
          (e.filePath.toLowerCase() === filePathLower ||
            e.filePath.toLowerCase().endsWith(`/${filePathLower}`) ||
            filePathLower.endsWith(`/${e.filePath.toLowerCase()}`))
      );
      const matchedCommitFile = decision.gitReferences.some((g) =>
        g.changedFiles.some((f) => f.toLowerCase() === filePathLower)
      );
      if (matchedEv.length === 0 && !matchedCommitFile) continue;
      score += 55;
      reasons.add("file-evidence-match");
      for (const e of matchedEv) matchedEvidenceIds.add(e.id);
    }

    // Commit SHA filter / boost
    if (commitLower) {
      const matchedGit = decision.gitReferences.some(
        (g) =>
          g.commitSha.toLowerCase().startsWith(commitLower) ||
          g.shortSha.toLowerCase().startsWith(commitLower)
      );
      const matchedEvCommit = decision.evidence.filter(
        (e) => e.commitSha && e.commitSha.toLowerCase().startsWith(commitLower)
      );
      if (!matchedGit && matchedEvCommit.length === 0) continue;
      score += 65;
      reasons.add("commit-match");
      for (const e of matchedEvCommit) matchedEvidenceIds.add(e.id);
    }

    if (query.length === 0) {
      // Filter-only browse mode
      score += decision.status === "accepted" ? 20 : 10;
      reasons.add("filter-match");
      results.push({
        decision,
        score,
        retrievalReasons: Array.from(reasons),
        matchedEvidenceIds: Array.from(matchedEvidenceIds)
      });
      continue;
    }

    const titleLower = decision.title.toLowerCase();
    if (titleLower === queryLower) {
      score += 120;
      reasons.add("exact-title");
    } else if (titleLower.includes(queryLower)) {
      score += 75;
      reasons.add("title-phrase");
    }

    // Category & tag matches
    const catWords = decision.category.replace(/_/g, " ");
    if (queryTerms.some((t) => catWords.includes(t))) {
      score += 24;
      reasons.add("category-match");
    }
    for (const tag of decision.tags) {
      const tl = tag.toLowerCase();
      if (queryTerms.some((t) => tl === t || tl.includes(t))) {
        score += 32;
        reasons.add("tag-match");
      }
    }

    // Tokenized keyword matching across title, summary, decision, rationale, alternatives
    const titleTokens = tokenize(decision.title);
    const bodyText = [
      decision.summary,
      decision.problem,
      decision.context,
      decision.decision,
      decision.rationale,
      ...decision.alternatives.map((a) => `${a.name} ${a.description} ${a.rejectionReason}`),
      ...decision.tradeoffs.map((t) => `${t.benefit} ${t.cost} ${t.acceptedCompromise}`)
    ].join(" ");
    const bodyTokens = tokenize(bodyText);
    const bodyTokenSet = new Set(bodyTokens);

    let matchedTermsCount = 0;
    for (const term of queryTerms) {
      if (titleTokens.includes(term)) {
        score += 28;
        matchedTermsCount += 1;
        reasons.add("title-keyword");
      } else if (bodyTokenSet.has(term)) {
        score += 16;
        matchedTermsCount += 1;
        reasons.add("body-keyword");
      } else if (
        titleTokens.some((tt) => boundedEditDistance1(term, tt)) ||
        decision.tags.some((tg) => boundedEditDistance1(term, tg.toLowerCase()))
      ) {
        score += 12;
        matchedTermsCount += 1;
        reasons.add("fuzzy-match");
      }

      // Evidence file / symbol matching
      for (const ev of decision.evidence) {
        const pathLower = (ev.filePath ?? "").toLowerCase();
        const symLower = (ev.symbolName ?? "").toLowerCase();
        if ((pathLower && pathLower.includes(term)) || (symLower && symLower.includes(term))) {
          score += 22;
          matchedTermsCount += 1;
          reasons.add("evidence-symbol-or-file");
          matchedEvidenceIds.add(ev.id);
        }
      }
    }

    // Multi-term synergy
    if (matchedTermsCount > 1) {
      score += Math.min(36, (matchedTermsCount - 1) * 10);
    }

    // Slight preference for accepted & current decisions when tie-breaking
    if (score > 0) {
      if (decision.status === "accepted") score += 6;
      if (decision.verificationStatus === "current") score += 4;

      results.push({
        decision,
        score,
        retrievalReasons: Array.from(reasons),
        matchedEvidenceIds: Array.from(matchedEvidenceIds)
      });
    }
  }

  // Boost directly related decisions of top matches slightly if they also matched
  const topIds = new Set(
    results
      .filter((r) => r.score >= 30)
      .slice(0, 3)
      .map((r) => r.decision.id)
  );
  for (const r of results) {
    if (r.decision.relatedDecisionIds.some((id) => topIds.has(id))) {
      r.score += 8;
      if (!r.retrievalReasons.includes("related-decision")) {
        r.retrievalReasons.push("related-decision");
      }
    }
  }

  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.decision.updatedAt.localeCompare(a.decision.updatedAt) ||
        a.decision.id.localeCompare(b.decision.id)
    )
    .slice(0, limit);
}

/**
 * Builds a chronological Decision Timeline from decision history events (Milestone 7.6).
 */
export function buildDecisionTimeline(params: {
  decisions: readonly EngineeringDecision[];
  order?: "newest" | "oldest";
  category?: DecisionCategory;
  status?: DecisionLifecycleStatus;
  tag?: string;
  query?: string;
}): DecisionTimelineEntry[] {
  const order = params.order ?? "newest";
  const tagLower = params.tag?.toLowerCase();
  const queryLower = (params.query ?? "").trim().toLowerCase();

  const entries: DecisionTimelineEntry[] = [];

  for (const decision of params.decisions) {
    if (params.category && decision.category !== params.category) continue;
    if (params.status && decision.status !== params.status) continue;
    if (tagLower && !decision.tags.some((t) => t.toLowerCase() === tagLower)) continue;
    if (
      queryLower &&
      !decision.title.toLowerCase().includes(queryLower) &&
      !decision.summary.toLowerCase().includes(queryLower) &&
      !decision.rationale.toLowerCase().includes(queryLower)
    ) {
      continue;
    }

    const latestCommit = decision.gitReferences[0]?.shortSha ?? null;
    const historyEvents =
      decision.history.length > 0
        ? decision.history
        : [
            {
              id: `evt-init-${decision.id}`,
              type: "created" as const,
              summary: decision.summary || decision.title,
              timestamp: decision.createdAt,
              actor: "developer" as const
            }
          ];

    for (const evt of historyEvents) {
      entries.push({
        eventId: evt.id,
        decisionId: decision.id,
        decisionTitle: decision.title,
        category: decision.category,
        status: decision.status,
        verificationStatus: decision.verificationStatus,
        eventType: evt.type,
        summary: evt.summary,
        evidenceCount: decision.evidence.filter((e) => !e.isHistorical).length,
        commitShortSha: latestCommit,
        relatedDecisionIds: decision.relatedDecisionIds,
        timestamp: evt.timestamp
      });
    }
  }

  return entries.sort((a, b) =>
    order === "newest"
      ? b.timestamp.localeCompare(a.timestamp) || a.eventId.localeCompare(b.eventId)
      : a.timestamp.localeCompare(b.timestamp) || a.eventId.localeCompare(b.eventId)
  );
}
