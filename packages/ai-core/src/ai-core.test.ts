import { describe, expect, it } from "vitest";
import { CodebaseAnswerSchema } from "@codemind/shared";
import { parseStructuredOutput } from "./index.js";

describe("@codemind/ai-core structured output validation", () => {
  it("parses valid structured JSON matching a Zod schema", () => {
    const raw = JSON.stringify({
      summary: "Express handles API routing.",
      explanation: ["Routes are mounted in app.ts"],
      references: [{ filePath: "apps/api/src/app.ts", startLine: 1 }],
      confidence: "high",
      limitations: []
    });

    const result = parseStructuredOutput(raw, CodebaseAnswerSchema);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.summary).toBe("Express handles API routing.");
    }
  });

  it("returns an error on malformed JSON", () => {
    const result = parseStructuredOutput("{not-json", CodebaseAnswerSchema);
    expect(result.ok).toBe(false);
  });

  it("returns an error when schema constraints are violated", () => {
    const result = parseStructuredOutput(JSON.stringify({ summary: "" }), CodebaseAnswerSchema);
    expect(result.ok).toBe(false);
  });
});
