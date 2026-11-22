import crypto from "node:crypto";
import {
  IntentRequestSchema,
  type IntentClarificationQuestion,
  type IntentCriterion,
  type IntentRequest,
  type IntentType
} from "@codemind/shared";
import type { AIProvider } from "../types/ai.types.js";

const INTENT_RULES: Array<{ type: IntentType; patterns: RegExp[]; weight: number }> = [
  {
    type: "bug_fix",
    patterns: [
      /\b(fix|bug|broken|crash|error|exception|fail|failing|incorrect|wrong|issue|regression|defect)\b/i
    ],
    weight: 3
  },
  {
    type: "security",
    patterns: [
      /\b(security|vuln|vulnerability|xss|sqli|csrf|injection|sanitize|secret|auth bypass|traversal|encrypt)\b/i
    ],
    weight: 3
  },
  {
    type: "performance",
    patterns: [
      /\b(faster|slow|latency|performance|speed up|bottleneck|memory leak|cpu|throughput|lag)\b/i
    ],
    weight: 2.8
  },
  {
    type: "optimization",
    patterns: [/\b(optimi[sz]e|optimi[sz]ation|reduce bundle|cache|memoize|deduplicate)\b/i],
    weight: 2.5
  },
  {
    type: "refactor",
    patterns: [/\b(refactor|clean up|simplify|extract|restructure|decouple|modularize)\b/i],
    weight: 2.6
  },
  {
    type: "testing",
    patterns: [/\b(test|tests|unit test|integration test|coverage|spec|vitest|jest|e2e)\b/i],
    weight: 2.6
  },
  {
    type: "documentation",
    patterns: [/\b(doc|docs|documentation|readme|jsdoc|comment|changelog|guide)\b/i],
    weight: 2.4
  },
  {
    type: "architecture_change",
    patterns: [
      /\b(architecture|migrate|migration|replace provider|redesign|layer|schema change)\b/i
    ],
    weight: 2.5
  },
  {
    type: "code_explanation",
    patterns: [/\b(explain|how does|how do|what does|walk through|understand|trace|summarize)\b/i],
    weight: 2.4
  },
  {
    type: "feature",
    patterns: [/\b(add|implement|create|build|support|introduce|enable|new feature)\b/i],
    weight: 2.2
  }
];

const BROAD_VAGUE_PATTERNS: RegExp[] = [
  /^(make|improve|fix|optimize|refactor)\s+(the\s+)?(app|application|code|codebase|project|system|everything)\s*(better|faster|cleaner|safer)?\.?$/i,
  /^(speed up|clean up|fix)\s+(the\s+)?(app|project|codebase)\.?$/i
];

function extractExplicitFilePaths(prompt: string): string[] {
  const matches = new Set<string>();
  const pathRe =
    /(?:^|[\s`'"(])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.[\]-]+)+\.[A-Za-z0-9]{1,8}|[A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|json|scss|css))/g;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(prompt)) !== null) {
    const candidate = (m[1] ?? "").trim();
    if (candidate && !candidate.startsWith("http")) {
      matches.add(candidate);
    }
  }
  return Array.from(matches);
}

function extractConstraints(prompt: string): string[] {
  const constraints: string[] = [];
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /\bwithout\s+breaking\b/i, label: "Must preserve backward compatibility" },
    { re: /\bdo\s+not\s+(modify|change|touch)\s+([^.,;]+)/i, label: "" },
    { re: /\bno\s+new\s+dependenc/i, label: "Do not add new dependencies" },
    { re: /\bkeep\s+existing\s+([^.,;]+)/i, label: "" },
    { re: /\bmust\s+not\s+([^.,;]+)/i, label: "" }
  ];

  for (const item of patterns) {
    const match = prompt.match(item.re);
    if (match) {
      constraints.push(item.label || match[0].trim());
    }
  }
  return Array.from(new Set(constraints));
}

function extractAffectedAreas(prompt: string): string[] {
  const areaKeywords = [
    "auth",
    "login",
    "password",
    "payment",
    "quiz",
    "api",
    "database",
    "frontend",
    "backend",
    "ui",
    "editor",
    "search",
    "ipc",
    "cache",
    "stream",
    "router",
    "route",
    "controller",
    "service",
    "test"
  ];
  const lower = prompt.toLowerCase();
  return areaKeywords.filter((kw) => new RegExp(`\\b${kw}`, "i").test(lower));
}

export function classifyIntentType(prompt: string): {
  intentType: IntentType;
  matchedScore: number;
} {
  let bestType: IntentType = "unknown";
  let bestScore = 0;

  for (const rule of INTENT_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(prompt)) {
        score += rule.weight;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = rule.type;
    }
  }

  return { intentType: bestType, matchedScore: bestScore };
}

/**
 * Deterministic Intent Parser (Milestone 6.1).
 * Converts a natural-language engineering request into a validated IntentRequest
 * without consuming Gemini quota for clear requests.
 */
export function parseIntentDeterministic(params: {
  workspaceId: string;
  prompt: string;
  intentId?: string;
}): IntentRequest {
  const trimmed = params.prompt.trim();
  const now = new Date().toISOString();
  const intentId = params.intentId ?? crypto.randomUUID();
  const { intentType, matchedScore } = classifyIntentType(trimmed);
  const relevantFiles = extractExplicitFilePaths(trimmed);
  const constraints = extractConstraints(trimmed);
  const affectedAreas = extractAffectedAreas(trimmed);

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  const isBroadVague = BROAD_VAGUE_PATTERNS.some((re) => re.test(trimmed));
  const hasSpecificTarget = relevantFiles.length > 0 || affectedAreas.length > 0 || wordCount >= 7;

  const ambiguityReasons: string[] = [];
  const missingInformation: string[] = [];
  const clarificationQuestions: IntentClarificationQuestion[] = [];

  if (intentType === "unknown") {
    ambiguityReasons.push(
      "Could not determine a concrete engineering action type from the request."
    );
    missingInformation.push(
      "Desired engineering outcome (bug fix, feature, refactor, performance, or explanation)."
    );
  }

  if (isBroadVague || (!hasSpecificTarget && intentType !== "code_explanation")) {
    ambiguityReasons.push("The request is too broad to safely scope code modifications.");
    missingInformation.push(
      "Specific module, user flow, symptom, or target metric to investigate."
    );
  }

  const isAmbiguous = ambiguityReasons.length > 0;

  if (isAmbiguous) {
    if (intentType === "performance" || intentType === "optimization") {
      clarificationQuestions.push({
        id: "q-perf-scope",
        question: "Which part of the application is slow and what behavior should we prioritize?",
        reason:
          "Broad performance goals need a concrete target area before proposing safe changes.",
        suggestedOptions: [
          "Initial startup or page load latency",
          "Specific API endpoint or backend service",
          "UI rendering or editor responsiveness",
          "Workspace indexing or search speed"
        ],
        answer: null
      });
    } else {
      clarificationQuestions.push({
        id: "q-target-scope",
        question:
          "Which module, file, or user workflow should CodeMind focus its investigation on?",
        reason: "Narrowing the scope prevents unrelated or speculative code changes.",
        suggestedOptions: [
          "Frontend UI / component flow",
          "Backend routes, controllers, or services",
          "Shared schemas or validation logic",
          "Tests and build/verification setup"
        ],
        answer: null
      });
    }
  }

  // Distinguish explicit user goal from AI/system-inferred acceptance criteria
  const acceptanceCriteria: IntentCriterion[] = [
    {
      id: "ac-user-1",
      description: trimmed,
      source: "user",
      confirmed: true
    }
  ];

  if (intentType === "bug_fix") {
    acceptanceCriteria.push({
      id: "ac-inferred-1",
      description: "Root cause is identified with source-line evidence before proposing edits.",
      source: "inferred",
      confirmed: false
    });
    acceptanceCriteria.push({
      id: "ac-inferred-2",
      description: "Existing and new regression tests pass without regressions.",
      source: "inferred",
      confirmed: false
    });
  } else if (intentType === "performance" || intentType === "optimization") {
    acceptanceCriteria.push({
      id: "ac-inferred-1",
      description:
        "Bottleneck is evidenced in source code and behavior remains functionally identical.",
      source: "inferred",
      confirmed: false
    });
  } else if (intentType === "security") {
    acceptanceCriteria.push({
      id: "ac-inferred-1",
      description:
        "Vulnerability path is closed without introducing regressions or exposing secrets.",
      source: "inferred",
      confirmed: false
    });
  }

  const confidence: "high" | "medium" | "low" = isAmbiguous
    ? "low"
    : matchedScore >= 2.5 && (relevantFiles.length > 0 || affectedAreas.length > 0)
      ? "high"
      : "medium";

  const status = isAmbiguous ? "clarification_required" : "ready_for_investigation";

  return IntentRequestSchema.parse({
    intentId,
    workspaceId: params.workspaceId,
    originalPrompt: trimmed,
    normalizedGoal: trimmed.replace(/\s+/g, " "),
    intentType,
    constraints,
    acceptanceCriteria,
    affectedAreas,
    relevantFiles,
    userPreferences: {},
    ambiguity: {
      isAmbiguous,
      reasons: ambiguityReasons,
      missingInformation
    },
    clarificationQuestions,
    confidence,
    status,
    createdAt: now,
    updatedAt: now
  });
}

/**
 * Applies user clarification answers to an ambiguous IntentRequest,
 * re-evaluating affected areas and advancing status to ready_for_investigation.
 */
export function applyIntentClarifications(
  intent: IntentRequest,
  answers: Record<string, string>,
  confirmedCriteriaIds?: string[]
): IntentRequest {
  const updatedQuestions = intent.clarificationQuestions.map((q) => ({
    ...q,
    answer: answers[q.id]?.trim() || q.answer
  }));

  const combinedText = [
    intent.originalPrompt,
    ...updatedQuestions.map((q) => q.answer).filter((a): a is string => Boolean(a))
  ].join(" ");

  const allAnswered = updatedQuestions.every((q) =>
    Boolean(q.answer && q.answer.trim().length > 0)
  );
  const extraAreas = extractAffectedAreas(combinedText);
  const extraFiles = extractExplicitFilePaths(combinedText);
  const { intentType } =
    intent.intentType === "unknown"
      ? classifyIntentType(combinedText)
      : { intentType: intent.intentType };

  const confirmedSet = new Set(confirmedCriteriaIds ?? []);
  const updatedCriteria = intent.acceptanceCriteria.map((c) =>
    confirmedSet.has(c.id) ? { ...c, confirmed: true } : c
  );

  return IntentRequestSchema.parse({
    ...intent,
    normalizedGoal: combinedText.replace(/\s+/g, " ").trim(),
    intentType,
    affectedAreas: Array.from(new Set([...intent.affectedAreas, ...extraAreas])),
    relevantFiles: Array.from(new Set([...intent.relevantFiles, ...extraFiles])),
    acceptanceCriteria: updatedCriteria,
    clarificationQuestions: updatedQuestions,
    ambiguity: {
      isAmbiguous: !allAnswered,
      reasons: allAnswered ? [] : intent.ambiguity.reasons,
      missingInformation: allAnswered ? [] : intent.ambiguity.missingInformation
    },
    confidence: allAnswered ? "medium" : intent.confidence,
    status: allAnswered ? "ready_for_investigation" : "clarification_required",
    updatedAt: new Date().toISOString()
  });
}

/**
 * Optional Gemini refinement — invoked ONLY when deterministic parsing flags ambiguity
 * and the caller explicitly opts in to AI refinement.
 */
export async function refineAmbiguousIntentWithAI(params: {
  intent: IntentRequest;
  provider: AIProvider;
  model?: string;
  signal?: AbortSignal;
}): Promise<IntentRequest> {
  if (!params.intent.ambiguity.isAmbiguous) {
    return params.intent;
  }

  const response = await params.provider.generate({
    model: params.model,
    responseFormat: "json",
    maxTokens: 512,
    signal: params.signal,
    messages: [
      {
        role: "system",
        content:
          "You refine ambiguous software engineering requests into a concise JSON object: { normalizedGoal: string, clarificationQuestion: string, suggestedOptions: string[] }. Never invent file paths."
      },
      {
        role: "user",
        content: `Original request: ${params.intent.originalPrompt}`
      }
    ]
  });

  try {
    const parsed = JSON.parse(response.content) as {
      normalizedGoal?: string;
      clarificationQuestion?: string;
      suggestedOptions?: string[];
    };
    const nextQuestions =
      typeof parsed.clarificationQuestion === "string" && parsed.clarificationQuestion.trim()
        ? [
            {
              id: "q-ai-1",
              question: parsed.clarificationQuestion.trim(),
              reason: "Clarifying broad request scope before investigating repository.",
              suggestedOptions: Array.isArray(parsed.suggestedOptions)
                ? parsed.suggestedOptions
                    .filter((s) => typeof s === "string" && s.trim())
                    .slice(0, 4)
                : [],
              answer: null
            }
          ]
        : params.intent.clarificationQuestions;

    return IntentRequestSchema.parse({
      ...params.intent,
      normalizedGoal:
        typeof parsed.normalizedGoal === "string" && parsed.normalizedGoal.trim()
          ? parsed.normalizedGoal.trim()
          : params.intent.normalizedGoal,
      clarificationQuestions: nextQuestions,
      updatedAt: new Date().toISOString()
    });
  } catch {
    return params.intent;
  }
}
