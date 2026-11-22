import { describe, expect, it, vi } from "vitest";
import {
  DECISION_SCHEMA_VERSION,
  EngineeringDecisionSchema,
  type EngineeringDecision
} from "@codemind/shared";
import {
  answerAskWhyDeterministic,
  assertDecisionStatusTransition,
  buildDecisionTimeline,
  computeDecisionVerificationState,
  DecisionStateTransitionError,
  detectDecisionConflictsLocal,
  NO_DECISION_HONEST_MESSAGE,
  searchDecisionsLocal,
  synthesizeAskWhyWithAI,
  type AIProvider
} from "../index.js";

function makeDecision(overrides: Partial<EngineeringDecision> = {}): EngineeringDecision {
  const now = "2026-11-22T12:00:00.000Z";
  return EngineeringDecisionSchema.parse({
    id: overrides.id ?? "dec-jwt-1",
    workspaceId: "ws-1",
    title: "Use JWT authentication for stateless API verification",
    summary: "Adopted signed JWT tokens for API endpoints.",
    context: "Desktop and web clients call stateless backend routes.",
    problem: "Needed authentication without sticky server sessions.",
    decision: "Use JWT bearer tokens verified in Express middleware.",
    rationale: "Stateless verification scales cleanly across API endpoints.",
    status: "accepted",
    category: "authentication",
    createdAt: now,
    updatedAt: now,
    decidedAt: now,
    createdBy: "developer",
    source: "manual",
    confidence: "verified",
    tags: ["jwt", "auth", "pkg:jsonwebtoken"],
    alternatives: [
      {
        id: "alt-1",
        name: "Server-side sessions",
        description: "Store session IDs in Redis",
        advantages: ["Easy immediate revocation"],
        disadvantages: ["Requires centralized session store"],
        rejectionReason: "Extra operational complexity for local-first desktop app",
        evaluationStatus: "rejected"
      },
      {
        id: "alt-2",
        name: "JWT authentication",
        description: "Stateless signed bearer tokens",
        advantages: ["Stateless verification"],
        disadvantages: ["Revocation requires short expiry"],
        rejectionReason: "",
        evaluationStatus: "chosen"
      }
    ],
    evidence: [
      {
        id: "ev-auth-1",
        type: "source_file",
        filePath: "backend/middleware/authMiddleware.ts",
        symbolName: "verifyJwtToken",
        startLine: 1,
        endLine: 30,
        contentHash: "hash-jwt-1",
        description: "JWT verification middleware",
        verificationStatus: "current",
        provenance: "verified",
        timestamp: now,
        staleReason: null,
        isHistorical: false
      }
    ],
    tradeoffs: [
      {
        id: "tr-1",
        benefit: "Stateless request verification",
        cost: "Token lifecycle management",
        risk: "Stolen tokens remain valid until expiry",
        acceptedCompromise: "Use short-lived access tokens",
        longTermImplications: "Requires refresh flow",
        reconsiderConditions: "If instant global session revocation becomes mandatory"
      }
    ],
    relatedDecisionIds: [],
    supersededById: null,
    relatedIntentId: null,
    gitReferences: [
      {
        commitSha: "abcdef1234567890",
        shortSha: "abcdef1",
        message: "feat: add JWT auth middleware",
        author: "Dev",
        date: now,
        changedFiles: ["backend/middleware/authMiddleware.ts"],
        verified: true
      }
    ],
    verificationStatus: "current",
    history: [
      {
        id: "hist-1",
        type: "created",
        summary: "Created JWT authentication decision",
        timestamp: "2026-11-20T10:00:00.000Z",
        actor: "developer"
      },
      {
        id: "hist-2",
        type: "accepted",
        summary: "Accepted JWT authentication strategy",
        timestamp: now,
        actor: "developer"
      }
    ],
    schemaVersion: DECISION_SCHEMA_VERSION,
    ...overrides
  });
}

describe("Phase 7 Core — Decision Memory State Machine, Search, Ask Why & Conflict Detection", () => {
  it("7.1 enforces valid status transitions and computes verification state from evidence freshness", () => {
    expect(() => assertDecisionStatusTransition("proposed", "accepted")).not.toThrow();
    expect(() => assertDecisionStatusTransition("accepted", "superseded")).not.toThrow();
    expect(() => assertDecisionStatusTransition("superseded", "accepted")).toThrow(
      DecisionStateTransitionError
    );
    expect(() => assertDecisionStatusTransition("rejected", "accepted")).toThrow(
      DecisionStateTransitionError
    );

    const d = makeDecision();
    expect(computeDecisionVerificationState("accepted", d.evidence)).toBe("current");
    expect(
      computeDecisionVerificationState("accepted", [
        { ...d.evidence[0]!, verificationStatus: "stale", provenance: "stale" }
      ])
    ).toBe("stale");
    expect(
      computeDecisionVerificationState("accepted", [
        d.evidence[0]!,
        { ...d.evidence[0]!, id: "ev-2", verificationStatus: "stale", provenance: "stale" }
      ])
    ).toBe("partially_stale");
    expect(computeDecisionVerificationState("superseded", d.evidence)).toBe("superseded");
  });

  it("7.6 & 7.7 searches and ranks decisions locally and builds filtered chronological timelines", () => {
    const jwt = makeDecision();
    const pg = makeDecision({
      id: "dec-pg-1",
      title: "Select PostgreSQL as primary relational database",
      category: "database",
      decision: "Use PostgreSQL with Prisma ORM.",
      rationale: "Strong relational integrity and JSONB support.",
      tags: ["postgresql", "prisma"],
      evidence: [],
      gitReferences: []
    });

    const results = searchDecisionsLocal({
      decisions: [pg, jwt],
      query: "Why does this project use JWT authentication?"
    });
    expect(results[0]?.decision.id).toBe("dec-jwt-1");
    expect(results[0]?.retrievalReasons.length).toBeGreaterThan(0);

    // File-path & commit SHA search
    const byFile = searchDecisionsLocal({
      decisions: [pg, jwt],
      filePath: "backend/middleware/authMiddleware.ts"
    });
    expect(byFile.map((r) => r.decision.id)).toEqual(["dec-jwt-1"]);

    const byCommit = searchDecisionsLocal({
      decisions: [pg, jwt],
      commitSha: "abcdef1"
    });
    expect(byCommit.map((r) => r.decision.id)).toEqual(["dec-jwt-1"]);

    // Timeline chronological ordering
    const timelineNewest = buildDecisionTimeline({ decisions: [jwt], order: "newest" });
    expect(timelineNewest[0]?.eventType).toBe("accepted");
    const timelineOldest = buildDecisionTimeline({ decisions: [jwt], order: "oldest" });
    expect(timelineOldest[0]?.eventType).toBe("created");
  });

  it("7.8 produces grounded Ask Why answers, responds honestly when unrecorded, and rejects fabricated AI citations", async () => {
    const jwt = makeDecision();

    const answered = answerAskWhyDeterministic({
      question: "Why is JWT verification implemented here?",
      decisions: [jwt],
      filePath: "backend/middleware/authMiddleware.ts",
      symbolName: "verifyJwtToken"
    });
    expect(answered.answered).toBe(true);
    expect(answered.confidence).toBe("verified");
    expect(answered.alternatives).toHaveLength(2);
    expect(answered.tradeoffs).toHaveLength(1);

    // Honest answer when no decision exists
    const unrecorded = answerAskWhyDeterministic({
      question: "Why does this project use GraphQL subscriptions?",
      decisions: [jwt]
    });
    expect(unrecorded.answered).toBe(false);
    expect(unrecorded.recordedDecision).toBe(NO_DECISION_HONEST_MESSAGE);
    expect(unrecorded.confidence).toBe("unknown");

    // AI synthesis citing a fabricated evidence ID MUST be discarded
    const badProvider: AIProvider = {
      id: "gemini",
      name: "Mock Gemini",
      defaultModel: "gemini-3.8-flash",
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          recordedDecision: "Hallucinated decision",
          reason: "Made up",
          citedDecisionIds: ["dec-jwt-1"],
          citedEvidenceIds: ["ev-fabricated-999"]
        }),
        model: "gemini-3.8-flash",
        provider: "gemini"
      }),
      stream: vi.fn()
    };

    const guarded = await synthesizeAskWhyWithAI({
      baseAnswer: answered,
      matchedDecisions: [jwt],
      provider: badProvider
    });
    expect(guarded.usedAiSynthesis).toBe(false);
    expect(guarded.honestNotice).toContain("discarded");
  });

  it("7.9 detects incompatible strategy conflicts and missing dependencies deterministically", () => {
    const jwt = makeDecision({ id: "dec-jwt", category: "authentication" });
    const sessions = makeDecision({
      id: "dec-sess",
      title: "Use server-side session cookies for authentication",
      summary: "Use Redis-backed session cookies.",
      decision: "Store server-side session cookies in Redis",
      category: "authentication"
    });
    const depDecision = makeDecision({
      id: "dec-dep",
      title: "Adopt axios for HTTP requests",
      category: "dependencies",
      tags: ["pkg:axios"]
    });

    const conflicts = detectDecisionConflictsLocal({
      decisions: [jwt, sessions, depDecision],
      installedPackages: ["react", "zod"]
    });
    expect(conflicts.some((c) => c.kind === "incompatible_strategy")).toBe(true);
    expect(conflicts.some((c) => c.kind === "missing_dependency")).toBe(true);
  });
});
