/**
 * Deterministic identifier tokenization, conservative morphological normalization,
 * and bounded Damerau-Levenshtein fuzzy matching for code intelligence search.
 */

const IRREGULAR_PLURALS: Record<string, string> = {
  quizzes: "quiz",
  queries: "query",
  entries: "entry",
  policies: "policy",
  proxies: "proxy",
  indices: "index",
  indexes: "index",
  dependencies: "dependency"
};

/**
 * Splits camelCase, PascalCase, snake_case, kebab-case, and path delimiters
 * into lowercase identifier tokens.
 */
export function splitIdentifierTokens(raw: string): string[] {
  if (!raw) return [];
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ");

  const tokens = spaced
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  return Array.from(new Set(tokens));
}

/**
 * Conservative morphological normalizer that preserves technical identifiers
 * while aligning common inflections (e.g., generating/generated/generation -> generat).
 */
export function normalizeMorphology(rawToken: string): string {
  const token = rawToken.toLowerCase().trim();
  if (token.length <= 3) return token;

  if (IRREGULAR_PLURALS[token]) {
    return IRREGULAR_PLURALS[token]!;
  }

  // Common verbal / nominal suffixes (only strip when stem remains >= 4 chars)
  const suffixes = [
    "ions",
    "ion",
    "ments",
    "ment",
    "ings",
    "ing",
    "ities",
    "ity",
    "ers",
    "er",
    "ies",
    "ed",
    "es",
    "s"
  ];
  for (const suffix of suffixes) {
    if (token.endsWith(suffix)) {
      const stem = token.slice(0, token.length - suffix.length);
      if (suffix === "ies" && stem.length >= 3) {
        return `${stem}y`;
      }
      if (stem.length >= 4) {
        // Normalize trailing 'e' differences (e.g., generate -> generat, creates -> creat)
        if (suffix === "s" && stem.endsWith("e") && stem.length >= 5) {
          return stem.slice(0, -1);
        }
        return stem;
      }
    }
  }

  if (token.endsWith("e") && token.length >= 6) {
    return token.slice(0, -1);
  }

  return token;
}

/**
 * Bounded Damerau-Levenshtein distance (treats adjacent transposition as 1 edit).
 * Returns `maxDistance + 1` early if strings cannot be within `maxDistance`.
 */
export function damerauLevenshteinDistance(a: string, b: string, maxDistance: number): number {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) {
    return maxDistance + 1;
  }
  if (a === b) return 0;

  const dp: number[][] = Array.from({ length: lenA + 1 }, () =>
    new Array<number>(lenB + 1).fill(0)
  );
  for (let i = 0; i <= lenA; i += 1) dp[i]![0] = i;
  for (let j = 0; j <= lenB; j += 1) dp[0]![j] = j;

  for (let i = 1; i <= lenA; i += 1) {
    let rowMin = maxDistance + 1;
    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2]![j - 2]! + cost);
      }

      dp[i]![j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }
  }

  return dp[lenA]![lenB]!;
}

export type SearchMatchKind = "exact" | "prefix" | "normalized" | "substring" | "fuzzy" | "none";

export interface TokenMatchScore {
  score: number;
  matchKind: SearchMatchKind;
}

/**
 * Scores a candidate string + pre-split identifier tokens against a single query term.
 * Strict hierarchy: exact > prefix > normalized > substring > fuzzy (1-edit) > fuzzy (2-edit, len >= 7).
 */
export function scoreCandidateAgainstTerm(
  candidateLower: string,
  candidateTokens: readonly string[],
  candidateStems: readonly string[],
  queryTermLower: string
): TokenMatchScore {
  if (!queryTermLower) return { score: 0, matchKind: "none" };

  if (candidateLower === queryTermLower) {
    return { score: 100, matchKind: "exact" };
  }

  for (const tok of candidateTokens) {
    if (tok === queryTermLower) {
      return { score: 92, matchKind: "exact" };
    }
  }

  if (candidateLower.startsWith(queryTermLower)) {
    return { score: 82, matchKind: "prefix" };
  }

  for (const tok of candidateTokens) {
    if (tok.startsWith(queryTermLower)) {
      return { score: 78, matchKind: "prefix" };
    }
  }

  const queryStem = normalizeMorphology(queryTermLower);
  if (queryStem.length >= 4) {
    for (const stem of candidateStems) {
      if (stem === queryStem) {
        return { score: 74, matchKind: "normalized" };
      }
      if (stem.startsWith(queryStem) || queryStem.startsWith(stem)) {
        if (Math.min(stem.length, queryStem.length) >= 4) {
          return { score: 66, matchKind: "normalized" };
        }
      }
    }
  }

  const subIdx = candidateLower.indexOf(queryTermLower);
  if (subIdx >= 0) {
    return { score: Math.max(25, 60 - Math.min(subIdx, 30)), matchKind: "substring" };
  }

  // Conservative bounded fuzzy matching: never fuzzily match very short tokens (< 4 chars)
  if (queryTermLower.length >= 4) {
    const maxDist = queryTermLower.length >= 7 ? 2 : 1;
    let bestDist = maxDist + 1;

    for (let i = 0; i < candidateTokens.length; i += 1) {
      const tok = candidateTokens[i]!;
      if (tok.length < 4) continue;
      // Require matching first character for 1-char typos on 4-char words to avoid false positives
      if (queryTermLower.length === 4 && tok[0] !== queryTermLower[0]) {
        continue;
      }
      const d1 = damerauLevenshteinDistance(queryTermLower, tok, maxDist);
      if (d1 < bestDist) bestDist = d1;

      const stem = candidateStems[i]!;
      if (stem.length >= 4 && queryStem.length >= 4) {
        const d2 = damerauLevenshteinDistance(queryStem, stem, maxDist);
        if (d2 < bestDist) bestDist = d2;
      }
    }

    if (bestDist === 1) {
      return { score: 48, matchKind: "fuzzy" };
    }
    if (bestDist === 2 && queryTermLower.length >= 7) {
      return { score: 34, matchKind: "fuzzy" };
    }
  }

  return { score: 0, matchKind: "none" };
}
