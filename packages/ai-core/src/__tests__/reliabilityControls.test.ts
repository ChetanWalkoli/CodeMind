import { describe, expect, it } from "vitest";
import { AIProviderError, AIRateLimiter, estimateRequestCostUsd } from "../index.js";

describe("Milestone 5.8 — Cost Estimation & Rate Limiting Controls", () => {
  it("returns pricingAvailable=false by default without fabricating Gemini pricing, and computes estimates when explicit pricing is provided", () => {
    const defaultUnpriced = estimateRequestCostUsd("gemini-3.8-flash", {
      inputTokens: 100_000,
      outputTokens: 50_000
    });
    expect(defaultUnpriced.pricingAvailable).toBe(false);
    expect(defaultUnpriced.estimatedUsd).toBeNull();
    expect(defaultUnpriced.isEstimate).toBe(true);

    const customPriced = estimateRequestCostUsd(
      "gemini-3.8-flash",
      { inputTokens: 100_000, outputTokens: 50_000 },
      {
        "gemini-3.8-flash": {
          modelId: "gemini-3.8-flash",
          inputUsdPerMillionTokens: 0.3,
          outputUsdPerMillionTokens: 2.5,
          lastVerified: "2026-01-01"
        }
      }
    );
    expect(customPriced.pricingAvailable).toBe(true);
    expect(customPriced.isEstimate).toBe(true);
    expect(customPriced.estimatedUsd).toBeCloseTo(0.155, 6);
  });

  it("enforces concurrency and sliding-window rate limits with idempotent release", () => {
    let now = 10_000;
    const limiter = new AIRateLimiter(
      { maxConcurrent: 2, maxRequestsPerWindow: 3, windowMs: 10_000 },
      () => now
    );

    const rel1 = limiter.acquire();
    const rel2 = limiter.acquire();
    expect(limiter.getStats()).toEqual({ activeCount: 2, recentWindowCount: 2 });

    // Exceeds maxConcurrent
    expect(() => limiter.acquire()).toThrow(AIProviderError);

    rel1();
    rel1(); // idempotent
    expect(limiter.getStats().activeCount).toBe(1);

    const rel3 = limiter.acquire();
    rel2();
    rel3();

    // Exceeds maxRequestsPerWindow (3 within 10s)
    expect(() => limiter.acquire()).toThrow(AIProviderError);

    // Advance past window -> allowed again
    now += 10_001;
    const rel4 = limiter.acquire();
    expect(limiter.getStats()).toEqual({ activeCount: 1, recentWindowCount: 1 });
    rel4();
  });
});
