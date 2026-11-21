import { describe, expect, it, vi } from "vitest";
import { AIProviderError } from "../errors/aiError.js";
import {
  GeminiProvider,
  type GeminiClientLike,
  type GeminiRawResponseChunk
} from "../providers/gemini/geminiProvider.js";

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

describe("GeminiProvider — Multi-Stage Timeouts, Cancellation & Retry Safety", () => {
  const apiKey = "AIzaSyTimeoutRegressionTestKey12345678";

  it("handles slow first response by timing out with first-response category, retrying, and recovering", async () => {
    let attempts = 0;
    const abortedSignals: boolean[] = [];

    const client: GeminiClientLike = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn().mockImplementation(async (params) => {
        attempts += 1;
        const signal = params.config?.abortSignal;
        signal?.addEventListener("abort", () => {
          abortedSignals.push(true);
        });
        async function* gen(): AsyncIterable<GeminiRawResponseChunk> {
          if (attempts === 1) {
            // Hang past firstResponseTimeoutMs (40ms)
            await delay(200, signal);
          }
          yield { text: "Recovered after slow TTFT" };
        }
        return gen();
      })
    };

    const provider = new GeminiProvider({
      apiKey,
      client,
      timeouts: {
        connectionTimeoutMs: 500,
        firstResponseTimeoutMs: 40,
        streamIdleTimeoutMs: 200,
        overallTimeoutMs: 2000
      },
      retryPolicy: { maxRetries: 1, initialDelayMs: 5, maxDelayMs: 10, backoffMultiplier: 2 },
      sleepFn: async () => undefined
    });

    let doneRetryCount = -1;
    const chunks: string[] = [];
    for await (const evt of provider.stream({ messages: [{ role: "user", content: "Explain" }] })) {
      if (evt.type === "delta") chunks.push(evt.text);
      if (evt.type === "done") doneRetryCount = evt.response.retryCount ?? 0;
    }

    expect(attempts).toBe(2);
    expect(abortedSignals.length).toBe(1); // First hanging attempt was aborted on underlying SDK signal
    expect(chunks.join("")).toBe("Recovered after slow TTFT");
    expect(doneRetryCount).toBe(1);
  });

  it("allows a slow but continuously progressing stream to finish when each chunk beats streamIdleTimeoutMs", async () => {
    const client: GeminiClientLike = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn().mockImplementation(async (params) => {
        const signal = params.config?.abortSignal;
        async function* gen(): AsyncIterable<GeminiRawResponseChunk> {
          // 5 chunks spaced 30ms apart = 150ms total > streamIdleTimeoutMs (70ms), but < overallTimeoutMs (1000ms)
          for (let i = 1; i <= 5; i += 1) {
            await delay(30, signal);
            yield { text: `part-${i} ` };
          }
        }
        return gen();
      })
    };

    const provider = new GeminiProvider({
      apiKey,
      client,
      timeouts: {
        connectionTimeoutMs: 500,
        firstResponseTimeoutMs: 200,
        streamIdleTimeoutMs: 70,
        overallTimeoutMs: 1000
      },
      retryPolicy: { maxRetries: 0, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 2 }
    });

    const parts: string[] = [];
    for await (const evt of provider.stream({ messages: [{ role: "user", content: "Explain" }] })) {
      if (evt.type === "delta") parts.push(evt.text);
    }

    expect(parts.join("")).toBe("part-1 part-2 part-3 part-4 part-5 ");
  });

  it("aborts underlying stream on inactivity (stream-idle) without retrying after partial output", async () => {
    let attempts = 0;
    let underlyingAborted = false;

    const client: GeminiClientLike = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn().mockImplementation(async (params) => {
        attempts += 1;
        const signal = params.config?.abortSignal;
        signal?.addEventListener("abort", () => {
          underlyingAborted = true;
        });
        async function* gen(): AsyncIterable<GeminiRawResponseChunk> {
          yield { text: "Partial chunk before stall" };
          // Stall past streamIdleTimeoutMs (45ms)
          await delay(400, signal);
          yield { text: "Never reached" };
        }
        return gen();
      })
    };

    const provider = new GeminiProvider({
      apiKey,
      client,
      timeouts: {
        connectionTimeoutMs: 500,
        firstResponseTimeoutMs: 200,
        streamIdleTimeoutMs: 45,
        overallTimeoutMs: 2000
      },
      retryPolicy: { maxRetries: 2, initialDelayMs: 5, maxDelayMs: 10, backoffMultiplier: 2 },
      sleepFn: async () => undefined
    });

    const received: string[] = [];
    let caught: unknown;
    try {
      for await (const evt of provider.stream({
        messages: [{ role: "user", content: "Explain" }]
      })) {
        if (evt.type === "delta") received.push(evt.text);
      }
    } catch (err) {
      caught = err;
    }

    expect(received).toEqual(["Partial chunk before stall"]);
    expect(attempts).toBe(1); // MUST NOT retry after partial delta was emitted
    expect(underlyingAborted).toBe(true);
    expect(caught).toBeInstanceOf(AIProviderError);
    expect((caught as AIProviderError).code).toBe("TIMEOUT");
    expect((caught as AIProviderError).timeoutCategory).toBe("stream-idle");
  });

  it("enforces overallTimeoutMs even on an actively progressing stream and cancels underlying request", async () => {
    let attempts = 0;
    let underlyingAborted = false;

    const client: GeminiClientLike = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn().mockImplementation(async (params) => {
        attempts += 1;
        const signal = params.config?.abortSignal;
        signal?.addEventListener("abort", () => {
          underlyingAborted = true;
        });
        async function* gen(): AsyncIterable<GeminiRawResponseChunk> {
          for (let i = 0; i < 20; i += 1) {
            await delay(20, signal);
            yield { text: `chunk-${i}` };
          }
        }
        return gen();
      })
    };

    const provider = new GeminiProvider({
      apiKey,
      client,
      timeouts: {
        connectionTimeoutMs: 500,
        firstResponseTimeoutMs: 500,
        streamIdleTimeoutMs: 500,
        overallTimeoutMs: 75
      },
      retryPolicy: { maxRetries: 2, initialDelayMs: 5, maxDelayMs: 10, backoffMultiplier: 2 },
      sleepFn: async () => undefined
    });

    let caught: unknown;
    try {
      for await (const _evt of provider.stream({
        messages: [{ role: "user", content: "Explain" }]
      })) {
        // consume
      }
    } catch (err) {
      caught = err;
    }

    expect(attempts).toBe(1);
    expect(underlyingAborted).toBe(true);
    expect(caught).toBeInstanceOf(AIProviderError);
    expect((caught as AIProviderError).code).toBe("TIMEOUT");
    expect((caught as AIProviderError).timeoutCategory).toBe("overall-generation");
  });

  it("propagates user Stop Generation cancellation directly to the underlying SDK abortSignal", async () => {
    let underlyingAborted = false;
    const userController = new AbortController();

    const client: GeminiClientLike = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn().mockImplementation(async (params) => {
        const signal = params.config?.abortSignal;
        signal?.addEventListener("abort", () => {
          underlyingAborted = true;
        });
        async function* gen(): AsyncIterable<GeminiRawResponseChunk> {
          yield { text: "First chunk" };
          // Wait indefinitely until aborted
          await delay(5000, signal);
        }
        return gen();
      })
    };

    const provider = new GeminiProvider({
      apiKey,
      client,
      timeouts: {
        connectionTimeoutMs: 5000,
        firstResponseTimeoutMs: 5000,
        streamIdleTimeoutMs: 5000,
        overallTimeoutMs: 5000
      }
    });

    let caught: unknown;
    try {
      for await (const evt of provider.stream({
        messages: [{ role: "user", content: "Explain" }],
        signal: userController.signal
      })) {
        if (evt.type === "delta") {
          userController.abort();
        }
      }
    } catch (err) {
      caught = err;
    }

    expect(underlyingAborted).toBe(true);
    expect(caught).toBeInstanceOf(AIProviderError);
    expect((caught as AIProviderError).code).toBe("CANCELLED");
  });

  it("retries network interruption before first delta but never duplicates after partial output", async () => {
    let attempts = 0;
    const client: GeminiClientLike = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn().mockImplementation(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("fetch failed: ECONNRESET");
        }
        async function* gen(): AsyncIterable<GeminiRawResponseChunk> {
          yield { text: "Partial before drop" };
          throw new TypeError("socket hang up");
        }
        return gen();
      })
    };

    const provider = new GeminiProvider({
      apiKey,
      client,
      retryPolicy: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2 },
      sleepFn: async () => undefined
    });

    const deltas: string[] = [];
    let caught: unknown;
    try {
      for await (const evt of provider.stream({
        messages: [{ role: "user", content: "Explain" }]
      })) {
        if (evt.type === "delta") deltas.push(evt.text);
      }
    } catch (err) {
      caught = err;
    }

    // Retried once after initial connection drop, then stopped immediately after mid-stream drop
    expect(attempts).toBe(2);
    expect(deltas).toEqual(["Partial before drop"]);
    expect(caught).toBeInstanceOf(AIProviderError);
    expect((caught as AIProviderError).code).toBe("NETWORK_ERROR");
  });

  it("retries 429 rate-limit errors with backoff and never retries 401 authentication errors", async () => {
    let rateAttempts = 0;
    const rateClient: GeminiClientLike = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn().mockImplementation(async () => {
        rateAttempts += 1;
        if (rateAttempts === 1) {
          throw Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 });
        }
        async function* gen(): AsyncIterable<GeminiRawResponseChunk> {
          yield { text: "Succeeded after 429 retry" };
        }
        return gen();
      })
    };

    const rateProvider = new GeminiProvider({
      apiKey,
      client: rateClient,
      retryPolicy: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2 },
      sleepFn: async () => undefined
    });

    const deltas: string[] = [];
    for await (const evt of rateProvider.stream({ messages: [{ role: "user", content: "Hi" }] })) {
      if (evt.type === "delta") deltas.push(evt.text);
    }
    expect(rateAttempts).toBe(2);
    expect(deltas.join("")).toBe("Succeeded after 429 retry");

    // 401 auth failure must NOT retry
    let authAttempts = 0;
    const authClient: GeminiClientLike = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn().mockImplementation(async () => {
        authAttempts += 1;
        throw Object.assign(new Error("API_KEY_INVALID"), { status: 401 });
      })
    };

    const authProvider = new GeminiProvider({
      apiKey,
      client: authClient,
      retryPolicy: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2 },
      sleepFn: async () => undefined
    });

    await expect(async () => {
      for await (const _evt of authProvider.stream({
        messages: [{ role: "user", content: "Hi" }]
      })) {
        // noop
      }
    }).rejects.toMatchObject({ code: "AUTH_ERROR", retryCount: 0 });
    expect(authAttempts).toBe(1);
  });
});
