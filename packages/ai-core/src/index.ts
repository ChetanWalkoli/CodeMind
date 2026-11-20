import type { z } from "zod";
export * from "./provider.js";

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
