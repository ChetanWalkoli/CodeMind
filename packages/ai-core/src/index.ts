import type { z } from "zod";

export * from "./types/ai.types.js";
export * from "./errors/aiError.js";
export * from "./models/catalog.js";
export * from "./reliability/retry.js";
export * from "./reliability/pricing.js";
export * from "./reliability/rateLimiter.js";
export * from "./providers/registry.js";
export {
  GeminiProvider,
  GeminiProviderConfigSchema,
  type GeminiClientLike,
  type GeminiProviderOptions,
  type GeminiRawResponseChunk
} from "./providers/gemini/geminiProvider.js";
export * from "./prompts/templates.js";
export * from "./prompts/injectionBoundary.js";
export * from "./prompts/promptComposer.js";
export * from "./context/ranking.js";
export * from "./budget/tokenEstimator.js";
export * from "./budget/tokenBudgeter.js";
export * from "./security/secretScanner.js";
export * from "./structured/responseParser.js";
export * from "./structured/referenceValidator.js";
export * from "./structured/structuredService.js";

/**
 * Safely parse and validate JSON structured output from an AI provider against a Zod schema.
 */
export function parseStructuredOutput<T>(
  rawContent: string,
  schema: z.ZodType<T>
): { ok: true; data: T } | { ok: false; error: string } {
  try {
    const parsedJson: unknown = JSON.parse(rawContent);
    const result = schema.safeParse(parsedJson);
    if (!result.success) {
      return {
        ok: false,
        error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      };
    }
    return { ok: true, data: result.data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid JSON response"
    };
  }
}
