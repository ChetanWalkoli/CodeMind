import {
  AIProviderError,
  formatTimeoutMessage,
  normalizeProviderError,
  type AITimeoutCategory
} from "../errors/aiError.js";

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterRatio?: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 8_000,
  backoffMultiplier: 2,
  jitterRatio: 0.2
};

export function computeBackoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  retryAfterMs?: number
): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, policy.maxDelayMs);
  }
  const base = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt);
  const capped = Math.min(base, policy.maxDelayMs);
  const jitter = policy.jitterRatio ?? 0;
  if (jitter <= 0) {
    return Math.round(capped);
  }
  const offset = capped * jitter * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + offset));
}

export function sleepWithAbort(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      new AIProviderError("CANCELLED", "AI request was cancelled during retry wait.", {
        retryable: false
      })
    );
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(
        new AIProviderError("CANCELLED", "AI request was cancelled during retry wait.", {
          retryable: false
        })
      );
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface LinkedSignal {
  signal: AbortSignal;
  isTimedOut: () => boolean;
  cleanup: () => void;
}

/**
 * Combines a caller-provided AbortSignal with a per-attempt timeout.
 */
export function createLinkedAbortSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal
): LinkedSignal {
  const controller = new AbortController();
  let timedOut = false;

  const onCallerAbort = () => {
    controller.abort(callerSignal?.reason);
  };

  if (callerSignal?.aborted) {
    controller.abort(callerSignal.reason);
  } else {
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  };
}

/**
 * Execute an async provider call with timeout, AbortSignal cancellation,
 * and controlled exponential backoff ONLY for retryable errors.
 */
export async function executeWithRetry<T>(
  operation: (signal: AbortSignal, attempt: number) => Promise<T>,
  options: {
    provider: string;
    timeoutMs: number;
    timeoutCategory?: AITimeoutCategory;
    signal?: AbortSignal;
    retryPolicy?: RetryPolicy;
    sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
    onRetry?: (info: { attempt: number; delayMs: number; error: AIProviderError }) => void;
  }
): Promise<T> {
  const policy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleepFn ?? sleepWithAbort;
  const timeoutCategory = options.timeoutCategory ?? "overall-generation";

  let attempt = 0;
  while (true) {
    if (options.signal?.aborted) {
      throw new AIProviderError("CANCELLED", "AI request was cancelled.", {
        provider: options.provider,
        retryable: false,
        retryCount: attempt
      });
    }

    const linked = createLinkedAbortSignal(options.timeoutMs, options.signal);
    try {
      const result = await operation(linked.signal, attempt);
      linked.cleanup();
      return result;
    } catch (rawError) {
      const timedOut = linked.isTimedOut();
      linked.cleanup();

      const normalized =
        timedOut && !options.signal?.aborted
          ? new AIProviderError(
              "TIMEOUT",
              formatTimeoutMessage(timeoutCategory, options.timeoutMs),
              {
                provider: options.provider,
                retryable: true,
                timeoutCategory,
                retryCount: attempt,
                cause: rawError
              }
            )
          : normalizeProviderError(rawError, options.provider);

      const canRetry =
        normalized.retryable && !options.signal?.aborted && attempt < policy.maxRetries;

      if (!canRetry) {
        if (normalized.retryCount === attempt) {
          throw normalized;
        }
        throw new AIProviderError(normalized.code, normalized.message, {
          provider: normalized.provider ?? options.provider,
          statusCode: normalized.statusCode,
          retryable: normalized.retryable,
          retryAfterMs: normalized.retryAfterMs,
          timeoutCategory: normalized.timeoutCategory,
          retryCount: attempt,
          cause: normalized
        });
      }

      const delayMs = computeBackoffDelayMs(attempt, policy, normalized.retryAfterMs);
      attempt += 1;
      options.onRetry?.({ attempt, delayMs, error: normalized });
      await sleep(delayMs, options.signal);
    }
  }
}
