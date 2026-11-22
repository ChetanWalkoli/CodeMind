import crypto from "node:crypto";
import {
  DecisionConflictSchema,
  type DecisionConflict,
  type EngineeringDecision
} from "@codemind/shared";

const MUTUALLY_EXCLUSIVE_STRATEGY_GROUPS: Array<{
  category: EngineeringDecision["category"];
  label: string;
  strategies: Array<{ name: string; pattern: RegExp }>;
}> = [
  {
    category: "authentication",
    label: "authentication strategy",
    strategies: [
      { name: "JWT", pattern: /\b(jwt|json web token)\b/i },
      {
        name: "Session Cookies",
        pattern: /\b(server-side session|cookie session|express-session)\b/i
      },
      { name: "OAuth/OIDC", pattern: /\b(oauth2?|oidc|openid connect)\b/i }
    ]
  },
  {
    category: "database",
    label: "primary database engine",
    strategies: [
      { name: "PostgreSQL", pattern: /\b(postgres|postgresql)\b/i },
      { name: "MongoDB", pattern: /\b(mongo|mongodb)\b/i },
      { name: "MySQL", pattern: /\b(mysql|mariadb)\b/i },
      { name: "SQLite", pattern: /\b(sqlite|better-sqlite3)\b/i }
    ]
  }
];

function detectStrategy(
  decision: EngineeringDecision,
  strategies: Array<{ name: string; pattern: RegExp }>
): string | null {
  const primaryText = `${decision.title} ${decision.decision}`;
  for (const s of strategies) {
    if (s.pattern.test(primaryText)) {
      return s.name;
    }
  }
  for (const s of strategies) {
    if (s.pattern.test(decision.summary)) {
      return s.name;
    }
  }
  return null;
}

/**
 * Deterministic Decision Conflict Detector (Milestone 7.9).
 * Identifies review-candidate conflicts across accepted decisions:
 * 1. Incompatible strategies in the same architectural domain (e.g., JWT vs Sessions).
 * 2. Accepted decision pointing to a `supersededById` without transitioning to `superseded`.
 * 3. Accepted `dependencies` decision referencing a package no longer in `installedPackages`.
 */
export function detectDecisionConflictsLocal(params: {
  decisions: readonly EngineeringDecision[];
  installedPackages?: readonly string[];
}): DecisionConflict[] {
  const conflicts: DecisionConflict[] = [];
  const accepted = params.decisions.filter((d) => d.status === "accepted");

  // 1. Mutually exclusive strategy conflicts
  for (const group of MUTUALLY_EXCLUSIVE_STRATEGY_GROUPS) {
    const inCategory = accepted.filter((d) => d.category === group.category);
    if (inCategory.length < 2) continue;

    const tagged = inCategory
      .map((d) => ({ decision: d, strategy: detectStrategy(d, group.strategies) }))
      .filter((x): x is { decision: EngineeringDecision; strategy: string } => x.strategy !== null);

    for (let i = 0; i < tagged.length; i += 1) {
      for (let j = i + 1; j < tagged.length; j += 1) {
        const a = tagged[i]!;
        const b = tagged[j]!;
        if (a.strategy !== b.strategy) {
          const id = `conf-${crypto
            .createHash("sha1")
            .update([a.decision.id, b.decision.id].sort().join("|"))
            .digest("hex")
            .slice(0, 10)}`;
          conflicts.push(
            DecisionConflictSchema.parse({
              conflictId: id,
              kind: "incompatible_strategy",
              severity: "high",
              decisionIds: [a.decision.id, b.decision.id],
              description: `Two accepted ${group.category} decisions prescribe different ${group.label} approaches: "${a.decision.title}" (${a.strategy}) vs "${b.decision.title}" (${b.strategy}).`,
              evidenceSummary:
                "Review whether one decision supersedes the other or whether both coexist intentionally."
            })
          );
        }
      }
    }
  }

  // 2. Accepted decision with a supersededById still marked accepted
  for (const d of accepted) {
    if (d.supersededById) {
      conflicts.push(
        DecisionConflictSchema.parse({
          conflictId: `conf-sup-${d.id.slice(0, 8)}`,
          kind: "supersession_pending",
          severity: "medium",
          decisionIds: [d.id, d.supersededById],
          description: `Decision "${d.title}" references superseding decision "${d.supersededById}" but is still marked accepted.`,
          evidenceSummary: "Transition status to superseded to keep decision history accurate."
        })
      );
    }
  }

  // 3. Accepted dependency decision referencing a package missing from package.json
  if (params.installedPackages && params.installedPackages.length > 0) {
    const pkgSet = new Set(params.installedPackages.map((p) => p.toLowerCase()));
    for (const d of accepted) {
      if (d.category !== "dependencies") continue;
      for (const tag of d.tags) {
        const lowerTag = tag.toLowerCase();
        if (lowerTag.startsWith("pkg:")) {
          const pkgName = lowerTag.slice(4);
          if (pkgName && !pkgSet.has(pkgName)) {
            conflicts.push(
              DecisionConflictSchema.parse({
                conflictId: `conf-dep-${crypto.createHash("sha1").update(`${d.id}:${pkgName}`).digest("hex").slice(0, 8)}`,
                kind: "missing_dependency",
                severity: "medium",
                decisionIds: [d.id],
                description: `Decision "${d.title}" references package "${pkgName}", which is no longer listed in package.json.`,
                evidenceSummary: `Package "${pkgName}" was not found among ${params.installedPackages.length} workspace dependencies.`
              })
            );
          }
        }
      }
    }
  }

  return conflicts;
}
