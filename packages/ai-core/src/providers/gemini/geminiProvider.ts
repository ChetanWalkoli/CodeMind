import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  AIProviderError,
  isAbortError,
  mapHttpStatusToAIError,
  normalizeProviderError,
  redactSecrets
} from "../../errors/aiError.js";
import { DEFAULT_MODEL_BY_PROVIDER, getModelConfig } from "../../models/catalog.js";
import {
  DEFAULT_RETRY_POLICY,
  executeWithRetry,
  type RetryPolicy
} from "../../reliability/retry.js";
import {
  AIMessageSchema,
  type AIProvider,
  type AIRequest,
  type AIResponse,
  type AIStreamEvent,
  type AIUsage
} from "../../types/ai.types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export const GeminiProviderConfigSchema = z.object({
  apiKey: z.string().trim().min(1, "Gemini API key is required."),
  defaultModel: z.string().trim().min(1).default(DEFAULT_MODEL_BY_PROVIDER.gemini),
  timeoutMs: z.number().int().positive().max(300_000).default(DEFAULT_TIMEOUT_MS)
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
  retryPolicy?: RetryPolicy;
  client?: GeminiClientLike;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
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

function createLinkedTimeoutController(
  timeoutMs: number,
  externalSignal?: AbortSignal
): { controller: AbortController; wasTimedOut: () => boolean; cleanup: () => void } {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    wasTimedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  };
}

/**
 * Isolated Google Gemini provider implementation behind the provider-independent AIProvider contract.
 * Uses the official `@google/genai` SDK without leaking SDK types outside this module.
 */
export class GeminiProvider implements AIProvider {
  public readonly id = "gemini" as const;
  public readonly name = "Google Gemini";
  public readonly defaultModel: string;

  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly client: GeminiClientLike;
  private readonly sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: GeminiProviderOptions) {
    const parsed = GeminiProviderConfigSchema.safeParse({
      apiKey: options.apiKey,
      defaultModel: options.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.gemini,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
    this.timeoutMs = parsed.data.timeoutMs;
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

  public async generate(input: AIRequest): Promise<AIResponse> {
    const { systemInstruction, contents } = validateAndFormatMessages(input);
    const model = this.resolveModel(input.model);
    const timeoutMs = input.timeoutMs ?? this.timeoutMs;

    return executeWithRetry(
      async (attemptSignal) => {
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
              retryable: false
            });
          }

          return {
            content,
            model,
            provider: this.id,
            finishReason: response.candidates?.[0]?.finishReason ?? null,
            usage: normalizeGeminiUsage(response.usageMetadata)
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
        timeoutMs,
        retryPolicy: this.retryPolicy,
        signal: input.signal,
        sleepFn: this.sleepFn
      }
    );
  }

  public async *stream(input: AIRequest): AsyncIterable<AIStreamEvent> {
    const { systemInstruction, contents } = validateAndFormatMessages(input);
    const model = this.resolveModel(input.model);
    const timeoutMs = input.timeoutMs ?? this.timeoutMs;

    // Retry transient 503/429/network failures when opening the stream (before any tokens are yielded)
    const iterable = await executeWithRetry(
      async (attemptSignal) => {
        try {
          return await this.client.generateContentStream({
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
        } catch (err) {
          if (isAbortError(err) && !input.signal?.aborted) {
            throw err;
          }
          throw mapGeminiError(err, this.apiKey, false);
        }
      },
      {
        provider: "gemini",
        timeoutMs,
        retryPolicy: this.retryPolicy,
        signal: input.signal,
        sleepFn: this.sleepFn
      }
    );

    const linked = createLinkedTimeoutController(timeoutMs, input.signal);
    let accumulated = "";
    let finishReason: string | null = null;
    let finalUsage: AIUsage | undefined;

    try {
      for await (const chunk of iterable) {
        if (linked.controller.signal.aborted) {
          throw mapGeminiError(
            new DOMException("Aborted", "AbortError"),
            this.apiKey,
            linked.wasTimedOut()
          );
        }

        if (typeof chunk.text === "string" && chunk.text.length > 0) {
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

      if (accumulated.trim().length === 0) {
        throw new AIProviderError(
          "INVALID_RESPONSE",
          "Gemini stream completed with empty content.",
          {
            provider: "gemini",
            retryable: false
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
          usage: finalUsage
        }
      };
    } catch (err) {
      throw mapGeminiError(err, this.apiKey, linked.wasTimedOut());
    } finally {
      linked.cleanup();
    }
  }
}
