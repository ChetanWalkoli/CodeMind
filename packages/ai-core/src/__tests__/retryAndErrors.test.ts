import { describe, expect, it, vi } from "vitest";
import { AIProviderError, mapHttpStatusToAIError, redactSecrets } from "../errors/aiError.js";
import { computeBackoffDelayMs, executeWithRetry } from "../reliability/retry.js";

describe("AI errors, secret redaction, and retry policy", () => {
  it("redacts API keys and bearer tokens from error messages", () => {
    const raw =
      "Unauthorized for Bearer AIzaSyAbc1234567890xyzABCDEF and api_key=AIzaSySecret9999999999999999";
    const redacted = redactSecrets(raw);

    expect(redacted).not.toContain("AIzaSyAbc1234567890xyzABCDEF");
    expect(redacted).not.toContain("AIzaSySecret9999999999999999");
    expect(redacted).toContain("[REDACTED]");
  });

  it("maps HTTP status codes to retryable vs non-retryable normalized errors", () => {
    const auth = mapHttpStatusToAIError(401, "Invalid key AIzaSy1234567890abcdefghij", "gemini");
    expect(auth.code).toBe("AUTH_ERROR");
    expect(auth.retryable).toBe(false);
    expect(auth.message).not.toContain("AIzaSy1234567890abcdefghij");

    const badReq = mapHttpStatusToAIError(400, "Bad model", "gemini");
    expect(badReq.code).toBe("INVALID_REQUEST");
    expect(badReq.retryable).toBe(false);

    const rateLimited = mapHttpStatusToAIError(429, "Slow down", "gemini", 1500);
    expect(rateLimited.code).toBe("RATE_LIMITED");
    expect(rateLimited.retryable).toBe(true);
    expect(rateLimited.retryAfterMs).toBe(1500);

    const serverErr = mapHttpStatusToAIError(503, "Unavailable", "gemini");
    expect(serverErr.code).toBe("PROVIDER_ERROR");
    expect(serverErr.retryable).toBe(true);
  });

  it("computes exponential backoff and honors capped Retry-After", () => {
    const policy = {
      maxRetries: 3,
      initialDelayMs: 100,
      maxDelayMs: 500,
      backoffMultiplier: 2,
      jitterRatio: 0
    };

    expect(computeBackoffDelayMs(0, policy)).toBe(100);
    expect(computeBackoffDelayMs(1, policy)).toBe(200);
    expect(computeBackoffDelayMs(3, policy)).toBe(500);
    expect(computeBackoffDelayMs(0, policy, 250)).toBe(250);
    expect(computeBackoffDelayMs(0, policy, 9_000)).toBe(500);
  });

  it("retries retryable errors up to maxRetries and never retries AUTH_ERROR or CANCELLED", async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    let calls = 0;

    const result = await executeWithRetry(
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new AIProviderError("RATE_LIMITED", "429", { retryable: true });
        }
        return "ok";
      },
      {
        provider: "gemini",
        timeoutMs: 5000,
        retryPolicy: {
          maxRetries: 2,
          initialDelayMs: 10,
          maxDelayMs: 50,
          backoffMultiplier: 2,
          jitterRatio: 0
        },
        sleepFn
      }
    );

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(sleepFn).toHaveBeenCalledTimes(2);

    // AUTH_ERROR must NOT be retried
    let authCalls = 0;
    await expect(
      executeWithRetry(
        async () => {
          authCalls += 1;
          throw new AIProviderError("AUTH_ERROR", "Denied", { retryable: false });
        },
        { provider: "gemini", timeoutMs: 5000, sleepFn }
      )
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });
    expect(authCalls).toBe(1);
  });

  it("normalizes timeouts and respects AbortSignal cancellation", async () => {
    await expect(
      executeWithRetry(
        async (signal) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
        {
          provider: "gemini",
          timeoutMs: 25,
          retryPolicy: {
            maxRetries: 0,
            initialDelayMs: 10,
            maxDelayMs: 50,
            backoffMultiplier: 2
          }
        }
      )
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    const controller = new AbortController();
    controller.abort();

    await expect(
      executeWithRetry(async () => "never", {
        provider: "gemini",
        timeoutMs: 5000,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
