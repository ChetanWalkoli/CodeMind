import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  AIProviderError,
  formatTimeoutMessage,
  isAbortError,
  mapHttpStatusToAIError,
  normalizeProviderError,
  redactSecrets,
  type AITimeoutCategory
} from "../../errors/aiError.js";
import { DEFAULT_MODEL_BY_PROVIDER, getModelConfig } from "../../models/catalog.js";
import {
  computeBackoffDelayMs,
  DEFAULT_RETRY_POLICY,
  executeWithRetry,
  sleepWithAbort,
  type RetryPolicy
} from "../../reliability/retry.js";
import {
  AIMessageSchema,
  DEFAULT_TIMEOUT_POLICY,
  type AIProvider,
  type AIRequest,
  type AIResponse,
  type AIStreamEvent,
  type AITimeoutPolicy,
  type AIUsage
} from "../../types/ai.types.js";

export const GeminiProviderConfigSchema = z.object({
  apiKey: z.string().trim().min(1, "Gemini API key is required."),
  defaultModel: z.string().trim().min(1).default(DEFAULT_MODEL_BY_PROVIDER.gemini),
  timeoutMs: z.number().int().positive().max(300_000).optional()
});

export interface GeminiRawResponseChunk {
  text?: string;
  candidates?: { finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export interface GeminiClientLike {
  generateContent(params: {
    model: string;
    contents: { role: "user" | "model"; parts: { text: string }[] }[];
    config?: {
      systemInstruction?: string;
      temperature?: number;
      maxOutputTokens?: number;
      responseMimeType?: string;
      abortSignal?: AbortSignal;
    };
  }): Promise<GeminiRawResponseChunk>;

  generateContentStream(params: {
    model: string;
    contents: { role: "user" | "model"; parts: { text: string }[] }[];
    config?: {
      systemInstruction?: string;
      temperature?: number;
      maxOutputTokens?: number;
      responseMimeType?: string;
      abortSignal?: AbortSignal;
    };
  }): Promise<AsyncIterable<GeminiRawResponseChunk>>;
}

export interface GeminiProviderOptions {
  apiKey: string;
  defaultModel?: string;
  timeoutMs?: number;
  timeouts?: Partial<AITimeoutPolicy>;
  retryPolicy?: RetryPolicy;
  client?: GeminiClientLike;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function buildTimeoutPolicy(
  base: AITimeoutPolicy,
  legacyTimeoutMs?: number,
  overrides?: Partial<AITimeoutPolicy>
): AITimeoutPolicy {
  const withLegacy: AITimeoutPolicy =
    legacyTimeoutMs !== undefined
      ? {
          contextPrepTimeoutMs: base.contextPrepTimeoutMs,
          connectionTimeoutMs: legacyTimeoutMs,
          firstResponseTimeoutMs: legacyTimeoutMs,
          streamIdleTimeoutMs: legacyTimeoutMs,
          overallTimeoutMs: legacyTimeoutMs
        }
      : { ...base };

  return {
    contextPrepTimeoutMs: overrides?.contextPrepTimeoutMs ?? withLegacy.contextPrepTimeoutMs,
    connectionTimeoutMs: overrides?.connectionTimeoutMs ?? withLegacy.connectionTimeoutMs,
    firstResponseTimeoutMs: overrides?.firstResponseTimeoutMs ?? withLegacy.firstResponseTimeoutMs,
    streamIdleTimeoutMs: overrides?.streamIdleTimeoutMs ?? withLegacy.streamIdleTimeoutMs,
    overallTimeoutMs: overrides?.overallTimeoutMs ?? withLegacy.overallTimeoutMs
  };
}

function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal
): Promise<IteratorResult<T>> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    iterator.next().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

function createSdkClient(apiKey: string): GeminiClientLike {
  const ai = new GoogleGenAI({ apiKey });
  return {
    generateContent: (params) =>
      ai.models.generateContent(params) as Promise<GeminiRawResponseChunk>,
    generateContentStream: (params) =>
      ai.models.generateContentStream(params) as Promise<AsyncIterable<GeminiRawResponseChunk>>
  };
}

function validateAndFormatMessages(input: AIRequest): {
  systemInstruction?: string;
  contents: { role: "user" | "model"; parts: { text: string }[] }[];
} {
  const result = z.array(AIMessageSchema).min(1).safeParse(input.messages);
  if (!result.success) {
    throw new AIProviderError(
      "INVALID_REQUEST",
      "AI request must include at least one valid message.",
      { provider: "gemini", retryable: false }
    );
  }

  const systemParts: string[] = [];
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];

  for (const msg of result.data) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
      });
    }
  }

  if (contents.length === 0) {
    throw new AIProviderError(
      "INVALID_REQUEST",
      "Gemini request must include at least one user or assistant message.",
      { provider: "gemini", retryable: false }
    );
  }

  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    contents
  };
}

function normalizeGeminiUsage(meta?: GeminiRawResponseChunk["usageMetadata"]): AIUsage | undefined {
  if (!meta) return undefined;
  if (meta.promptTokenCount === undefined && meta.candidatesTokenCount === undefined) {
    return undefined;
  }
  const inputTokens = meta.promptTokenCount ?? 0;
  const outputTokens = meta.candidatesTokenCount ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: meta.totalTokenCount ?? inputTokens + outputTokens
  };
}

function unwrapGeminiErrorMessage(raw: string): string {
  let current = raw.trim();
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current.startsWith("{")) break;
    try {
      const parsed = JSON.parse(current) as {
        error?: { message?: unknown };
        message?: unknown;
      };
      const inner =
        typeof parsed?.error?.message === "string"
          ? parsed.error.message
          : typeof parsed?.message === "string"
            ? parsed.message
            : null;
      if (!inner || inner.trim() === current) break;
      current = inner.trim();
    } catch {
      break;
    }
  }
  return current;
}

function sanitizeKeyFromMessage(message: string, apiKey: string): string {
  let safe = redactSecrets(unwrapGeminiErrorMessage(message));
  if (apiKey.trim().length > 0) {
    safe = safe.split(apiKey.trim()).join("[REDACTED]");
  }
  return safe;
}

function mapGeminiError(err: unknown, apiKey: string, timedOut: boolean): AIProviderError {
  if (err instanceof AIProviderError) {
    return new AIProviderError(err.code, sanitizeKeyFromMessage(err.message, apiKey), {
      provider: "gemini",
      statusCode: err.statusCode,
      retryable: err.retryable,
      retryAfterMs: err.retryAfterMs
    });
  }

  if (timedOut) {
    return new AIProviderError("TIMEOUT", "Gemini request timed out.", {
      provider: "gemini",
      retryable: true
    });
  }

  if (isAbortError(err)) {
    return new AIProviderError("CANCELLED", "Gemini request was cancelled.", {
      provider: "gemini",
      retryable: false
    });
  }

  const errObj = err as { status?: number; statusCode?: number; message?: string; code?: string };
  const rawMessage = sanitizeKeyFromMessage(
    err instanceof Error ? err.message : String(errObj?.message ?? err),
    apiKey
  );

  const statusCode =
    typeof errObj?.status === "number"
      ? errObj.status
      : typeof errObj?.statusCode === "number"
        ? errObj.statusCode
        : undefined;

  if (statusCode !== undefined) {
    return mapHttpStatusToAIError(statusCode, rawMessage, "gemini");
  }

  if (/API[_ ]KEY[_ ]INVALID|PERMISSION_DENIED|UNAUTHENTICATED|401|403/i.test(rawMessage)) {
    return new AIProviderError("AUTH_ERROR", `Gemini authentication failed: ${rawMessage}`, {
      provider: "gemini",
      statusCode: 401,
      retryable: false
    });
  }

  if (/RESOURCE_EXHAUSTED|RATE_LIMIT|429|quota/i.test(rawMessage)) {
    return new AIProviderError(
      "RATE_LIMITED",
      `Gemini rate limit or quota exceeded: ${rawMessage}`,
      {
        provider: "gemini",
        statusCode: 429,
        retryable: true
      }
    );
  }

  if (/UNAVAILABLE|INTERNAL|503|500|502/i.test(rawMessage)) {
    return new AIProviderError("PROVIDER_ERROR", `Gemini service error: ${rawMessage}`, {
      provider: "gemini",
      statusCode: 503,
      retryable: true
    });
  }

  const normalized = normalizeProviderError(err, "gemini");
  return new AIProviderError(normalized.code, sanitizeKeyFromMessage(normalized.message, apiKey), {
    provider: "gemini",
    statusCode: normalized.statusCode,
    retryable: normalized.retryable
  });
}

/**
 * Isolated Google Gemini provider implementation behind the provider-independent AIProvider contract.
 * Uses the official `@google/genai` SDK without leaking SDK types outside this module.
 *
 * Timeout & cancellation design:
 * - Separate connection, first-response (TTFT), stream-idle, and overall generation timers.
 * - A single per-attempt AbortController is passed to `@google/genai` and remains linked to
 *   caller cancellation (`input.signal`) for the entire lifetime of the stream.
 * - Retries occur ONLY before any response delta has been yielded (never duplicating output).
 */
export class GeminiProvider implements AIProvider {
  public readonly id = "gemini" as const;
  public readonly name = "Google Gemini";
  public readonly defaultModel: string;

  private readonly apiKey: string;
  private readonly timeoutPolicy: AITimeoutPolicy;
  private readonly retryPolicy: RetryPolicy;
  private readonly client: GeminiClientLike;
  private readonly sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: GeminiProviderOptions) {
    const parsed = GeminiProviderConfigSchema.safeParse({
      apiKey: options.apiKey,
      defaultModel: options.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.gemini,
      timeoutMs: options.timeoutMs
    });

    if (!parsed.success) {
      throw new AIProviderError(
        "INVALID_CONFIG",
        parsed.error.issues.map((i) => i.message).join("; "),
        { provider: "gemini", retryable: false }
      );
    }

    this.apiKey = parsed.data.apiKey;
    this.defaultModel = parsed.data.defaultModel;
    this.timeoutPolicy = buildTimeoutPolicy(
      DEFAULT_TIMEOUT_POLICY,
      parsed.data.timeoutMs,
      options.timeouts
    );
    this.retryPolicy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
    this.client = options.client ?? createSdkClient(this.apiKey);
    this.sleepFn = options.sleepFn;
  }

  private resolveModel(requestedModel?: string): string {
    const modelId = requestedModel?.trim() || this.defaultModel;
    const config = getModelConfig(modelId);
    if (!config || config.provider !== "gemini") {
      throw new AIProviderError(
        "INVALID_CONFIG",
        `Model "${modelId}" is not registered in the Gemini model catalog.`,
        { provider: "gemini", retryable: false }
      );
    }
    return modelId;
  }

  private resolveTimeouts(input: AIRequest): AITimeoutPolicy {
    return buildTimeoutPolicy(this.timeoutPolicy, input.timeoutMs, input.timeouts);
  }

  public async generate(input: AIRequest): Promise<AIResponse> {
    const { systemInstruction, contents } = validateAndFormatMessages(input);
    const model = this.resolveModel(input.model);
    const timeouts = this.resolveTimeouts(input);

    return executeWithRetry(
      async (attemptSignal, attempt) => {
        try {
          const response = await this.client.generateContent({
            model,
            contents,
            config: {
              systemInstruction,
              temperature: input.temperature,
              maxOutputTokens: input.maxTokens,
              responseMimeType: input.responseFormat === "json" ? "application/json" : undefined,
              abortSignal: attemptSignal
            }
          });

          const content = response.text ?? "";
          if (content.trim().length === 0) {
            throw new AIProviderError("INVALID_RESPONSE", "Gemini returned an empty response.", {
              provider: "gemini",
              retryable: false,
              retryCount: attempt
            });
          }

          return {
            content,
            model,
            provider: this.id,
            finishReason: response.candidates?.[0]?.finishReason ?? null,
            usage: normalizeGeminiUsage(response.usageMetadata),
            retryCount: attempt
          };
        } catch (err) {
          if (isAbortError(err) && !input.signal?.aborted) {
            throw err; // Let executeWithRetry distinguish timeout vs caller cancel
          }
          throw mapGeminiError(err, this.apiKey, false);
        }
      },
      {
        provider: "gemini",
        timeoutMs: timeouts.overallTimeoutMs,
        timeoutCategory: "overall-generation",
        retryPolicy: this.retryPolicy,
        signal: input.signal,
        sleepFn: this.sleepFn
      }
    );
  }

  public async *stream(input: AIRequest): AsyncIterable<AIStreamEvent> {
    const { systemInstruction, contents } = validateAndFormatMessages(input);
    const model = this.resolveModel(input.model);
    const timeouts = this.resolveTimeouts(input);
    const sleep = this.sleepFn ?? sleepWithAbort;

    let overallTimedOut = false;
    let activeAttemptController: AbortController | null = null;
    const overallTimer = setTimeout(() => {
      overallTimedOut = true;
      activeAttemptController?.abort(new Error("Overall generation timeout"));
    }, timeouts.overallTimeoutMs);

    let attempt = 0;

    try {
      while (true) {
        if (input.signal?.aborted) {
          throw new AIProviderError("CANCELLED", "Gemini request was cancelled.", {
            provider: "gemini",
            retryable: false,
            retryCount: attempt
          });
        }
        if (overallTimedOut) {
          throw new AIProviderError(
            "TIMEOUT",
            formatTimeoutMessage("overall-generation", timeouts.overallTimeoutMs),
            {
              provider: "gemini",
              retryable: false,
              timeoutCategory: "overall-generation",
              retryCount: attempt
            }
          );
        }

        const attemptController = new AbortController();
        activeAttemptController = attemptController;

        const onCallerAbort = () => {
          attemptController.abort(input.signal?.reason);
        };
        input.signal?.addEventListener("abort", onCallerAbort, { once: true });

        let triggeredTimeout: { category: AITimeoutCategory; ms: number } | null = null;
        let connectionTimer: ReturnType<typeof setTimeout> | null = null;
        let firstResponseTimer: ReturnType<typeof setTimeout> | null = null;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        const clearAttemptTimers = () => {
          if (connectionTimer) {
            clearTimeout(connectionTimer);
            connectionTimer = null;
          }
          if (firstResponseTimer) {
            clearTimeout(firstResponseTimer);
            firstResponseTimer = null;
          }
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
        };

        const armIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            triggeredTimeout = { category: "stream-idle", ms: timeouts.streamIdleTimeoutMs };
            attemptController.abort(new Error("Stream idle timeout"));
          }, timeouts.streamIdleTimeoutMs);
        };

        let iterator: AsyncIterator<GeminiRawResponseChunk> | null = null;
        let hasYieldedDelta = false;
        let accumulated = "";
        let finishReason: string | null = null;
        let finalUsage: AIUsage | undefined;

        try {
          // Stage 1: Connection / stream open timeout
          connectionTimer = setTimeout(() => {
            triggeredTimeout = { category: "connection", ms: timeouts.connectionTimeoutMs };
            attemptController.abort(new Error("Connection timeout"));
          }, timeouts.connectionTimeoutMs);

          const iterable = await this.client.generateContentStream({
            model,
            contents,
            config: {
              systemInstruction,
              temperature: input.temperature,
              maxOutputTokens: input.maxTokens,
              responseMimeType: input.responseFormat === "json" ? "application/json" : undefined,
              abortSignal: attemptController.signal
            }
          });

          if (connectionTimer) {
            clearTimeout(connectionTimer);
            connectionTimer = null;
          }

          // Stage 2: First-response (TTFT) timeout
          firstResponseTimer = setTimeout(() => {
            triggeredTimeout = { category: "first-response", ms: timeouts.firstResponseTimeoutMs };
            attemptController.abort(new Error("First response timeout"));
          }, timeouts.firstResponseTimeoutMs);

          iterator = iterable[Symbol.asyncIterator]();
          let receivedFirstEvent = false;

          while (true) {
            const step = await nextWithAbort(iterator, attemptController.signal);
            if (step.done) break;

            if (!receivedFirstEvent) {
              receivedFirstEvent = true;
              if (firstResponseTimer) {
                clearTimeout(firstResponseTimer);
                firstResponseTimer = null;
              }
            }

            // Stage 3: Reset streaming idle timeout on every incoming chunk
            armIdleTimer();

            const chunk = step.value;
            if (typeof chunk.text === "string" && chunk.text.length > 0) {
              hasYieldedDelta = true;
              accumulated += chunk.text;
              yield { type: "delta", text: chunk.text };
            }

            if (chunk.candidates?.[0]?.finishReason) {
              finishReason = chunk.candidates[0].finishReason;
            }

            const usage = normalizeGeminiUsage(chunk.usageMetadata);
            if (usage) {
              finalUsage = usage;
              yield { type: "usage", usage };
            }
          }

          clearAttemptTimers();

          if (accumulated.trim().length === 0) {
            throw new AIProviderError(
              "INVALID_RESPONSE",
              "Gemini stream completed with empty content.",
              {
                provider: "gemini",
                retryable: false,
                retryCount: attempt
              }
            );
          }

          yield {
            type: "done",
            response: {
              content: accumulated,
              model,
              provider: this.id,
              finishReason,
              usage: finalUsage,
              retryCount: attempt
            }
          };
          return;
        } catch (err) {
          clearAttemptTimers();
          if (iterator && typeof iterator.return === "function") {
            void Promise.resolve(iterator.return()).catch(() => undefined);
          }

          let normalized: AIProviderError;
          if (input.signal?.aborted) {
            normalized = new AIProviderError("CANCELLED", "Gemini request was cancelled.", {
              provider: "gemini",
              retryable: false,
              retryCount: attempt,
              cause: err
            });
          } else if (overallTimedOut) {
            normalized = new AIProviderError(
              "TIMEOUT",
              formatTimeoutMessage("overall-generation", timeouts.overallTimeoutMs),
              {
                provider: "gemini",
                retryable: false,
                timeoutCategory: "overall-generation",
                retryCount: attempt,
                cause: err
              }
            );
          } else if (triggeredTimeout) {
            const { category, ms } = triggeredTimeout;
            normalized = new AIProviderError("TIMEOUT", formatTimeoutMessage(category, ms), {
              provider: "gemini",
              retryable:
                !hasYieldedDelta && (category === "connection" || category === "first-response"),
              timeoutCategory: category,
              retryCount: attempt,
              cause: err
            });
          } else {
            const baseErr = mapGeminiError(err, this.apiKey, false);
            normalized = new AIProviderError(baseErr.code, baseErr.message, {
              provider: "gemini",
              statusCode: baseErr.statusCode,
              retryable: !hasYieldedDelta && baseErr.retryable,
              retryAfterMs: baseErr.retryAfterMs,
              timeoutCategory: baseErr.timeoutCategory,
              retryCount: attempt,
              cause: baseErr
            });
          }

          // Never retry after partial content has been yielded or if cancelled / overall timed out
          const canRetry =
            !hasYieldedDelta &&
            !input.signal?.aborted &&
            !overallTimedOut &&
            normalized.retryable &&
            attempt < this.retryPolicy.maxRetries;

          if (!canRetry) {
            throw normalized;
          }

          const delayMs = computeBackoffDelayMs(attempt, this.retryPolicy, normalized.retryAfterMs);
          attempt += 1;
          await sleep(delayMs, input.signal);
        } finally {
          clearAttemptTimers();
          input.signal?.removeEventListener("abort", onCallerAbort);
          if (activeAttemptController === attemptController) {
            activeAttemptController = null;
          }
        }
      }
    } finally {
      clearTimeout(overallTimer);
      activeAttemptController = null;
    }
  }
}
