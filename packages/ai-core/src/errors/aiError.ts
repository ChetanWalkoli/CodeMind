export type AIErrorCode =
  | "INVALID_CONFIG"
  | "INVALID_REQUEST"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "CANCELLED"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "PROVIDER_ERROR";

export interface AIProviderErrorOptions {
  provider?: string;
  statusCode?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /sk-[a-zA-Z0-9_-]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /(api[_-]?key\s*[:=]\s*["']?)[^\s"',;]+/gi
];

/**
 * Redact API keys and bearer tokens from error messages before surfacing or logging.
 */
export function redactSecrets(input: string): string {
  let sanitized = input;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, prefix?: string) => {
      if (typeof prefix === "string" && prefix.length > 0 && !prefix.startsWith("sk-")) {
        return `${prefix}[REDACTED]`;
      }
      if (/^bearer\s+/i.test(match)) {
        return "Bearer [REDACTED]";
      }
      return "[REDACTED]";
    });
  }
  return sanitized;
}

export class AIProviderError extends Error {
  public readonly code: AIErrorCode;
  public readonly provider?: string;
  public readonly statusCode?: number;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;

  constructor(code: AIErrorCode, message: string, options: AIProviderErrorOptions = {}) {
    super(
      redactSecrets(message),
      options.cause !== undefined ? { cause: options.cause } : undefined
    );
    this.name = "AIProviderError";
    this.code = code;
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; code?: string };
  return err.name === "AbortError" || err.code === "ABORT_ERR";
}

export function normalizeProviderError(error: unknown, provider?: string): AIProviderError {
  if (error instanceof AIProviderError) {
    return error;
  }

  if (isAbortError(error)) {
    return new AIProviderError("CANCELLED", "AI request was cancelled.", {
      provider,
      retryable: false,
      cause: error
    });
  }

  if (error instanceof TypeError) {
    return new AIProviderError(
      "NETWORK_ERROR",
      `Network error while contacting AI provider: ${error.message}`,
      {
        provider,
        retryable: true,
        cause: error
      }
    );
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  return new AIProviderError("PROVIDER_ERROR", rawMessage || "Unexpected AI provider error.", {
    provider,
    retryable: false,
    cause: error
  });
}

export function mapHttpStatusToAIError(
  statusCode: number,
  rawBodyMessage: string,
  provider: string,
  retryAfterMs?: number
): AIProviderError {
  const safeMsg = redactSecrets(rawBodyMessage || `Provider returned HTTP ${statusCode}.`);

  if (statusCode === 401 || statusCode === 403) {
    return new AIProviderError("AUTH_ERROR", `Authentication failed (${statusCode}): ${safeMsg}`, {
      provider,
      statusCode,
      retryable: false
    });
  }

  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return new AIProviderError(
      "INVALID_REQUEST",
      `Invalid AI request (${statusCode}): ${safeMsg}`,
      {
        provider,
        statusCode,
        retryable: false
      }
    );
  }

  if (statusCode === 429) {
    return new AIProviderError("RATE_LIMITED", `Rate limit exceeded (429): ${safeMsg}`, {
      provider,
      statusCode,
      retryable: true,
      retryAfterMs
    });
  }

  if (statusCode === 408 || statusCode === 504) {
    return new AIProviderError(
      "TIMEOUT",
      `Provider request timed out (${statusCode}): ${safeMsg}`,
      {
        provider,
        statusCode,
        retryable: true,
        retryAfterMs
      }
    );
  }

  if (statusCode >= 500) {
    return new AIProviderError(
      "PROVIDER_ERROR",
      `Provider server error (${statusCode}): ${safeMsg}`,
      {
        provider,
        statusCode,
        retryable: true,
        retryAfterMs
      }
    );
  }

  return new AIProviderError("PROVIDER_ERROR", `Provider error (${statusCode}): ${safeMsg}`, {
    provider,
    statusCode,
    retryable: false
  });
}
