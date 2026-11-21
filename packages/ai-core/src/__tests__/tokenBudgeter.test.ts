import { describe, expect, it } from "vitest";
import type { AIContextSnapshot } from "@codemind/shared";
import {
  AIProviderError,
  budgetContextForModel,
  defaultTokenEstimator,
  detectInlineSecrets,
  HeuristicTokenEstimator,
  type ModelConfig
} from "../index.js";

function makeSnapshot(overrides: Partial<AIContextSnapshot> = {}): AIContextSnapshot {
  return {
    snapshotId: "snap-budget-test",
    workspaceRoot: "/workspace/demo",
    taskType: "code-qa",
    templateId: "codemind.code-qa",
    templateVersion: "1.0.0",
    query: "How does verifyToken work?",
    items: [
      {
        id: "src/auth.ts:1-6",
        filePath: "src/auth.ts",
        language: "typescript",
        contentHash: "hash-auth",
        startLine: 1,
        endLine: 6,
        symbols: ["verifyToken"],
        reasons: ["active-file", "symbol-match"],
        relevanceScore: 160,
        byteLength: 160,
        estimatedTokens: 40,
        truncated: false,
        content: [
          'import { readToken } from "./tokenStore";',
          "export function verifyToken(token: string): boolean {",
          "  const stored = readToken(token);",
          "  return stored.length > 0;",
          "}",
          "// end of auth"
        ].join("\n")
      },
      {
        id: "src/tokenStore.ts:1-4",
        filePath: "src/tokenStore.ts",
        language: "typescript",
        contentHash: "hash-store",
        startLine: 1,
        endLine: 4,
        symbols: ["readToken"],
        reasons: ["dependency"],
        relevanceScore: 25,
        byteLength: 120,
        estimatedTokens: 30,
        truncated: false,
        content: [
          "export function readToken(id: string): string {",
          "  return id.trim();",
          "}",
          "// end of store"
        ].join("\n")
      },
      {
        id: "src/lowPriority.ts:1-20",
        filePath: "src/lowPriority.ts",
        language: "typescript",
        contentHash: "hash-low",
        startLine: 1,
        endLine: 20,
        symbols: ["helper"],
        reasons: ["dependent"],
        relevanceScore: 10,
        byteLength: 800,
        estimatedTokens: 200,
        truncated: false,
        content: Array.from(
          { length: 20 },
          (_, i) => `export const helperLine${i + 1} = "some verbose helper content ${i + 1}";`
        ).join("\n")
      }
    ],
    excluded: [],
    totalBytes: 1080,
    estimatedTokens: 270,
    budgetBytes: 32768,
    createdAt: "2026-11-22T00:00:00.000Z",
    ...overrides
  };
}

describe("Milestone 5.4 — Model-Aware Token Budgeting & Inline Secret Detection", () => {
  it("conservatively estimates code-heavy content without underestimating and marks estimates as non-exact", () => {
    const estimator = new HeuristicTokenEstimator();
    expect(estimator.id).toBe("heuristic-code-v2");
    expect(estimator.isExact).toBe(false);
    expect(defaultTokenEstimator.isExact).toBe(false);

    const prose = "The quick brown fox jumps over the lazy dog repeatedly in plain English.";
    const denseCode =
      "const fn=(a:Record<string,number[]>)=>Object.entries(a).map(([k,v])=>({k,s:v.reduce((x,y)=>x+y,0)}));";

    const naiveFourCharsPerToken = Math.ceil(denseCode.length / 4);
    expect(estimator.estimateText(denseCode)).toBeGreaterThan(naiveFourCharsPerToken);
    expect(estimator.estimateText(prose)).toBeGreaterThan(0);
    expect(estimator.estimateMessages([{ role: "user", content: prose }])).toBeGreaterThan(
      estimator.estimateText(prose)
    );
  });

  it("enforces maxInputTokens on the complete composed provider request including framing and references", () => {
    const tightModel: ModelConfig = {
      id: "tight-composed-model",
      provider: "gemini",
      displayName: "Tight Composed Model",
      contextWindowTokens: 700,
      maxOutputTokens: 128,
      freeTierAvailable: true,
      lifecycleStatus: "active",
      supportsJsonMode: true,
      supportsStreaming: false
    };

    const snap = makeSnapshot();
    const result = budgetContextForModel(snap, {
      modelId: tightModel.id,
      modelConfigOverride: tightModel,
      reservedOutputTokens: 128,
      safetyMarginRatio: 0.1
    });

    const completeComposedTokens = defaultTokenEstimator.estimateMessages(result.messages);
    expect(completeComposedTokens).toBe(result.allocation.totalEstimatedInputTokens);
    expect(result.allocation.totalEstimatedInputTokens).toBeLessThanOrEqual(
      result.allocation.maxInputTokens
    );
    expect(result.snapshot.budget).toEqual(result.allocation);
  });

  it("respects different model context windows, output reservations, and safety margins from MODEL_CATALOG", () => {
    const snap = makeSnapshot();

    const flash = budgetContextForModel(snap, {
      modelId: "gemini-3.8-flash",
      reservedOutputTokens: 4096,
      safetyMarginRatio: 0.1
    });
    expect(flash.allocation.contextWindowTokens).toBe(1_048_576);
    expect(flash.allocation.maxOutputTokens).toBe(65_536);
    expect(flash.allocation.reservedOutputTokens).toBe(4096);
    expect(flash.allocation.safetyMarginTokens).toBe(Math.ceil(1_048_576 * 0.1));
    expect(flash.allocation.maxInputTokens).toBe(1_048_576 - 4096 - Math.ceil(1_048_576 * 0.1));
    expect(flash.allocation.isExactEstimate).toBe(false);

    const pro = budgetContextForModel(snap, {
      modelId: "gemini-3.6-flash",
      reservedOutputTokens: 8192,
      safetyMarginRatio: 0.05
    });
    expect(pro.allocation.contextWindowTokens).toBe(1_048_576);
    expect(pro.allocation.maxOutputTokens).toBe(65_536);
    expect(pro.allocation.reservedOutputTokens).toBe(8192);
    expect(pro.allocation.safetyMarginTokens).toBe(Math.ceil(1_048_576 * 0.05));
    expect(pro.allocation.maxInputTokens).toBeGreaterThan(flash.allocation.maxInputTokens);
  });

  it("clamps reservedOutputTokens to model maxOutputTokens and rejects unknown models", () => {
    const snap = makeSnapshot();

    const clamped = budgetContextForModel(snap, {
      modelId: "gemini-3.8-flash",
      reservedOutputTokens: 99_999
    });
    expect(clamped.allocation.reservedOutputTokens).toBe(65_536);

    expect(() => budgetContextForModel(snap, { modelId: "unknown-model-xyz" })).toThrow(
      AIProviderError
    );
  });

  it("rejects oversized user questions that exceed maxInputTokens while preserving mandatory instructions", () => {
    const smallModel: ModelConfig = {
      id: "tiny-test-model",
      provider: "gemini",
      displayName: "Tiny Test Model",
      contextWindowTokens: 512,
      maxOutputTokens: 128,
      freeTierAvailable: true,
      lifecycleStatus: "active",
      supportsJsonMode: true,
      supportsStreaming: false
    };

    const oversizedQuery = "Explain this behavior ".repeat(200);
    const snap = makeSnapshot({ query: oversizedQuery });

    expect(() =>
      budgetContextForModel(snap, {
        modelId: smallModel.id,
        modelConfigOverride: smallModel,
        reservedOutputTokens: 128,
        safetyMarginRatio: 0.1
      })
    ).toThrow(AIProviderError);
  });

  it("prioritizes high-relevance files, omits low-relevance files first, and truncates only on whole-line boundaries", () => {
    const snap = makeSnapshot();

    // Tight context budget that fits src/auth.ts and src/tokenStore.ts, forcing lowPriority.ts to be truncated or omitted
    const tight = budgetContextForModel(snap, {
      modelId: "gemini-3.8-flash",
      maxContextTokens: 320
    });

    const includedPaths = tight.snapshot.items.map((i) => i.filePath);
    expect(includedPaths[0]).toBe("src/auth.ts");
    expect(includedPaths).toContain("src/tokenStore.ts");

    // Verify no mid-line truncation on any truncated item
    for (const item of tight.snapshot.items) {
      if (item.truncated) {
        const original = snap.items.find((o) => o.filePath === item.filePath)!;
        const originalLines = original.content.split("\n");
        const keptLines = item.content.split("\n");
        for (let i = 0; i < keptLines.length; i += 1) {
          expect(keptLines[i]).toBe(originalLines[i]);
        }
      }
    }

    // Even tighter budget: only src/auth.ts fits, lower-relevance files are omitted and reported
    const veryTight = budgetContextForModel(snap, {
      modelId: "gemini-3.8-flash",
      maxContextTokens: 180
    });

    expect(veryTight.snapshot.items.map((i) => i.filePath)).toEqual(["src/auth.ts"]);
    expect(veryTight.omittedItems.map((o) => o.filePath)).toContain("src/lowPriority.ts");
    expect(veryTight.snapshot.excluded).toEqual(
      expect.arrayContaining([{ filePath: "src/lowPriority.ts", reason: "token-budget-exceeded" }])
    );
  });

  it("trims optional conversation history oldest-first without displacing mandatory instructions", () => {
    const snap = makeSnapshot({ items: [] });
    const result = budgetContextForModel(snap, {
      modelId: "gemini-3.8-flash",
      history: {
        messages: [
          { role: "user", content: "Old turn 1 ".repeat(30) },
          { role: "assistant", content: "Old answer 1 ".repeat(30) },
          { role: "user", content: "Recent question" }
        ],
        maxHistoryTokens: 25
      }
    });

    expect(result.historyIncluded).toHaveLength(1);
    expect(result.historyIncluded[0]?.content).toBe("Recent question");
    expect(result.historyOmittedCount).toBe(2);
    expect(result.messages[0]?.role).toBe("system");
    expect(result.messages[result.messages.length - 1]?.role).toBe("user");
  });

  it("detects high-confidence inline secrets in normal source files without returning raw secret values", () => {
    const cleanCode = "export const endpoint = 'https://api.example.com';\n";
    expect(detectInlineSecrets(cleanCode)).toEqual([]);

    const leakyCode = [
      "export const config = {",
      '  geminiKey: "AIzaSy1234567890abcdefghij1234567890",',
      '  awsKey: "AKIAIOSFODNN7EXAMPLE",',
      '  pem: "-----BEGIN RSA PRIVATE KEY-----"',
      "};"
    ].join("\n");

    const matches = detectInlineSecrets(leakyCode);
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(matches.map((m) => m.ruleId)).toEqual(
      expect.arrayContaining(["google-api-key", "aws-access-key", "private-key-block"])
    );
    expect(JSON.stringify(matches)).not.toContain("AIzaSy1234567890");
    expect(JSON.stringify(matches)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});
