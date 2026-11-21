import { describe, expect, it, vi } from "vitest";
import type { AIContextSnapshot } from "@codemind/shared";
import {
  AIProviderError,
  executeStructuredRequest,
  parseAndValidateStructuredResponse,
  parseSafeJsonResponse,
  validateSourceReferences,
  type AIProvider
} from "../index.js";

const SNAPSHOT: AIContextSnapshot = {
  snapshotId: "snap-struct-1",
  workspaceRoot: "/repo",
  taskType: "code-qa",
  templateId: "codemind.code-qa",
  templateVersion: "1.0.0",
  query: "Explain verifyToken",
  items: [
    {
      id: "src/auth.ts:1-10",
      filePath: "src/auth.ts",
      language: "typescript",
      contentHash: "hash-auth-1",
      startLine: 1,
      endLine: 10,
      symbols: ["verifyToken"],
      reasons: ["active-file"],
      relevanceScore: 100,
      byteLength: 100,
      estimatedTokens: 30,
      truncated: false,
      content: "export function verifyToken(token: string) {\n  return token.length > 0;\n}"
    }
  ],
  excluded: [],
  totalBytes: 100,
  estimatedTokens: 30,
  budgetBytes: 32768,
  createdAt: "2026-11-22T00:00:00.000Z"
};

const VALID_ANSWER_JSON = JSON.stringify({
  summary: "verifyToken checks that a token string is non-empty.",
  explanation: ["Checks token.length > 0 in src/auth.ts."],
  references: [{ filePath: "src/auth.ts", startLine: 1, endLine: 3, symbol: "verifyToken" }],
  confidence: "high",
  limitations: [],
  verifiedFacts: ["verifyToken returns token.length > 0."],
  interpretations: ["This is a minimal presence check rather than JWT signature validation."],
  recommendations: ["Add cryptographic verification before production use."],
  assumptions: []
});

describe("Milestone 5.5 — Structured AI Responses & Source Reference Validation", () => {
  it("parses raw JSON and Markdown-fenced JSON and rejects empty, malformed, or non-object responses", () => {
    expect(parseSafeJsonResponse('{"ok": true}')).toEqual({ ok: true });
    expect(parseSafeJsonResponse('```json\n{"ok": true}\n```')).toEqual({ ok: true });

    expect(() => parseSafeJsonResponse("   ")).toThrow(AIProviderError);
    expect(() => parseSafeJsonResponse("{ invalid json")).toThrow(AIProviderError);
    expect(() => parseSafeJsonResponse("[1, 2, 3]")).toThrow(AIProviderError);
  });

  it("redacts secrets in malformed JSON parser errors", () => {
    const secret = "AIzaSySecret1234567890abcdefXYZ";
    try {
      parseSafeJsonResponse(`not json ${secret}`);
      expect.fail("Expected parse error");
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).message).not.toContain(secret);
    }
  });

  it("validates source references against the approved snapshot and rejects fabricated files or out-of-range lines", () => {
    const ok = validateSourceReferences(
      [{ filePath: "src/auth.ts", startLine: 1, endLine: 5, symbol: "verifyToken" }],
      SNAPSHOT
    );
    expect(ok.valid).toBe(true);
    expect(ok.verifiedReferences).toHaveLength(1);
    expect(ok.verifiedReferences[0]?.verified).toBe(true);

    const fabricatedFile = validateSourceReferences(
      [{ filePath: "src/nonexistent.ts", startLine: 1, endLine: 2 }],
      SNAPSHOT
    );
    expect(fabricatedFile.valid).toBe(false);
    expect(fabricatedFile.invalidReferences[0]?.reason).toMatch(/not included/i);

    const outOfRange = validateSourceReferences(
      [{ filePath: "src/auth.ts", startLine: 1, endLine: 99 }],
      SNAPSHOT
    );
    expect(outOfRange.valid).toBe(false);
    expect(outOfRange.invalidReferences[0]?.reason).toMatch(/outside approved range/i);

    const traversal = validateSourceReferences(
      [{ filePath: "../etc/passwd", startLine: 1, endLine: 1 }],
      SNAPSHOT
    );
    expect(traversal.valid).toBe(false);
  });

  it("validates structured response schemas and performs at most one bounded correction retry", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        // First response has a fabricated file reference -> fails validation
        content: JSON.stringify({
          summary: "Bad ref",
          explanation: ["Test"],
          references: [{ filePath: "src/fabricated.ts", startLine: 1, endLine: 2 }],
          confidence: "low",
          limitations: []
        }),
        model: "gemini-3.8-flash",
        provider: "gemini"
      })
      .mockResolvedValueOnce({
        // Second response succeeds after 1 bounded correction retry
        content: `\`\`\`json\n${VALID_ANSWER_JSON}\n\`\`\``,
        model: "gemini-3.8-flash",
        provider: "gemini",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
      });

    const provider: AIProvider = {
      id: "gemini",
      name: "Google Gemini",
      defaultModel: "gemini-3.8-flash",
      generate,
      stream: vi.fn()
    };

    const result = await executeStructuredRequest({
      provider,
      model: "gemini-3.8-flash",
      messages: [
        { role: "system", content: "System" },
        { role: "user", content: "User" }
      ],
      snapshot: SNAPSHOT
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]?.[0]?.responseFormat).toBe("json");
    expect(result.retried).toBe(true);
    expect(result.kind).toBe("codebase-answer");
    expect(result.verifiedReferences).toHaveLength(1);

    // If both attempts fail, must throw and never return a successful result (no unlimited loop)
    const alwaysBad = vi.fn().mockResolvedValue({
      content: "not json at all",
      model: "gemini-3.8-flash",
      provider: "gemini"
    });
    await expect(
      executeStructuredRequest({
        provider: { ...provider, generate: alwaysBad },
        model: "gemini-3.8-flash",
        messages: [{ role: "user", content: "Hi" }],
        snapshot: SNAPSHOT
      })
    ).rejects.toThrow(AIProviderError);
    expect(alwaysBad).toHaveBeenCalledTimes(2);
  });

  it("validates optimization-findings and impact-report allowlisted schemas", () => {
    const optJson = JSON.stringify({
      summary: "One finding",
      findings: [
        {
          id: "opt-1",
          filePath: "src/auth.ts",
          title: "Weak token check",
          description: "Only checks length",
          category: "security",
          severity: "high",
          confidence: "high",
          evidence: ["token.length > 0"],
          recommendation: "Verify cryptographic signature"
        }
      ],
      references: [{ filePath: "src/auth.ts", startLine: 1, endLine: 3 }],
      limitations: []
    });

    const validated = parseAndValidateStructuredResponse({
      rawContent: optJson,
      kind: "optimization-findings",
      snapshot: SNAPSHOT
    });
    expect(validated.kind).toBe("optimization-findings");
    expect(validated.verifiedReferences.length).toBeGreaterThanOrEqual(1);
  });
});
