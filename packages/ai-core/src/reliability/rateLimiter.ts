import { AIProviderError } from "../errors/aiError.js";

export interface RateLimitConfig {
  readonly maxConcurrent: number;
  readonly maxRequestsPerWindow: number;
  readonly windowMs: number;
}

export const DESKTOP_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxConcurrent: 3,
  maxRequestsPerWindow: 30,
  windowMs: 60_000
};

export const API_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxConcurrent: 10,
  maxRequestsPerWindow: 120,
  windowMs: 60_000
};

/**
 * Concurrency + sliding-window rate limiter preventing accidental request storms
 * and duplicate concurrent bursts.
 */
export class AIRateLimiter {
  private readonly config: RateLimitConfig;
  private readonly nowFn: () => number;
  private activeCount = 0;
  private readonly timestamps: number[] = [];

  constructor(config: RateLimitConfig = DESKTOP_RATE_LIMIT_CONFIG, nowFn: () => number = Date.now) {
    this.config = config;
    this.nowFn = nowFn;
  }

  private pruneWindow(now: number): void {
    const cutoff = now - this.config.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! <= cutoff) {
      this.timestamps.shift();
    }
  }

  /**
   * Acquires a slot and returns a release function (idempotent).
   * Throws AIProviderError("RATE_LIMITED") if concurrency or window limits are exceeded.
   */
  public acquire(): () => void {
    const now = this.nowFn();
    this.pruneWindow(now);

    if (this.activeCount >= this.config.maxConcurrent) {
      throw new AIProviderError(
        "RATE_LIMITED",
        `Maximum concurrent AI requests (${this.config.maxConcurrent}) reached. Wait for an active request to complete or cancel it.`,
        { retryable: true, retryAfterMs: 1000 }
      );
    }

    if (this.timestamps.length >= this.config.maxRequestsPerWindow) {
      const oldest = this.timestamps[0]!;
      const retryAfterMs = Math.max(250, oldest + this.config.windowMs - now);
      throw new AIProviderError(
        "RATE_LIMITED",
        `AI request rate limit (${this.config.maxRequestsPerWindow} per ${Math.round(this.config.windowMs / 1000)}s) reached. Try again shortly.`,
        { retryable: true, retryAfterMs }
      );
    }

    this.activeCount += 1;
    this.timestamps.push(now);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount = Math.max(0, this.activeCount - 1);
    };
  }

  public getStats(): { activeCount: number; recentWindowCount: number } {
    this.pruneWindow(this.nowFn());
    return {
      activeCount: this.activeCount,
      recentWindowCount: this.timestamps.length
    };
  }
}
