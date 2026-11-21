import { AIProviderError, redactSecrets } from "../errors/aiError.js";

const MARKDOWN_JSON_FENCE_REGEX = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i;

/**
 * Safely parses provider output as a JSON object without eval() or new Function().
 * Supports raw JSON and JSON wrapped in a single Markdown ```json ... ``` fence.
 */
export function parseSafeJsonResponse(
  rawContent: string,
  provider?: string
): Record<string, unknown> {
  if (typeof rawContent !== "string") {
    throw new AIProviderError("INVALID_RESPONSE", "AI response content must be a string.", {
      provider,
      retryable: false
    });
  }

  const trimmed = rawContent.trim();
  if (trimmed.length === 0) {
    throw new AIProviderError("INVALID_RESPONSE", "AI provider returned an empty response.", {
      provider,
      retryable: false
    });
  }

  let jsonCandidate = trimmed;
  const fenceMatch = MARKDOWN_JSON_FENCE_REGEX.exec(trimmed);
  if (fenceMatch && fenceMatch[1] !== undefined) {
    jsonCandidate = fenceMatch[1].trim();
  }

  if (jsonCandidate.length === 0) {
    throw new AIProviderError(
      "INVALID_RESPONSE",
      "AI provider returned an empty JSON code block.",
      { provider, retryable: false }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch (err) {
    const reason = err instanceof Error ? redactSecrets(err.message) : "Malformed JSON";
    throw new AIProviderError("INVALID_RESPONSE", `AI response is not valid JSON: ${reason}`, {
      provider,
      retryable: false
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AIProviderError("INVALID_RESPONSE", "AI structured response must be a JSON object.", {
      provider,
      retryable: false
    });
  }

  return parsed as Record<string, unknown>;
}
