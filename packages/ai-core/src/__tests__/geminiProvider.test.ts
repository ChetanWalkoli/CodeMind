import { describe, expect, it, vi } from "vitest";
import {
  AIProviderError,
  GeminiProvider,
  type AIStreamEvent,
  type GeminiClientLike
} from "../index.js";

function createMockClient(overrides: Partial<GeminiClientLike> = {}): GeminiClientLike {
  return {
    generateContent: vi.fn().mockResolvedValue({
      text: "Hello from Gemini!",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 42,
        candidatesTokenCount: 12,
        totalTokenCount: 54
      }
    }),
    generateContentStream: vi.fn().mockImplementation(async () => {
      return (async function* () {
        yield { text: "Hello " };
        yield {
          text: "Gemini!",
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 10, totalTokenCount: 50 }
        };
      })();
    }),
    ...overrides
  };
}

describe("GeminiProvider", () => {
  const testApiKey = "AIzaSyTestGeminiKey1234567890abcdefgh";

  it("generates text, maps system instructions, sets JSON mode, and extracts usage metadata", async () => {
    const client = createMockClient();
    const provider = new GeminiProvider({ apiKey: testApiKey, client });

    const res = await provider.generate({
      model: "gemini-3.8-flash",
      responseFormat: "json",
      maxTokens: 1024,
      messages: [
        { role: "system", content: "You are CodeMind." },
        { role: "user", content: "Explain auth.ts" }
      ]
    });

    expect(res.content).toBe("Hello from Gemini!");
    expect(res.provider).toBe("gemini");
    expect(res.model).toBe("gemini-3.8-flash");
    expect(res.usage).toEqual({ inputTokens: 42, outputTokens: 12, totalTokens: 54 });

    expect(client.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.8-flash",
        contents: [{ role: "user", parts: [{ text: "Explain auth.ts" }] }],
        config: expect.objectContaining({
          systemInstruction: "You are CodeMind.",
          maxOutputTokens: 1024,
          responseMimeType: "application/json"
        })
      })
    );
  });

  it("streams incremental deltas, usage, and final done response", async () => {
    const client = createMockClient();
    const provider = new GeminiProvider({ apiKey: testApiKey, client });

    const events: AIStreamEvent[] = [];
    for await (const evt of provider.stream({
      model: "gemini-3.8-flash",
      messages: [{ role: "user", content: "Hi" }]
    })) {
      events.push(evt);
    }

    expect(events.map((e) => e.type)).toEqual(["delta", "delta", "usage", "done"]);
    const doneEvt = events.find((e) => e.type === "done");
    expect(doneEvt?.type === "done" && doneEvt.response.content).toBe("Hello Gemini!");
    expect(doneEvt?.type === "done" && doneEvt.response.usage).toEqual({
      inputTokens: 40,
      outputTokens: 10,
      totalTokens: 50
    });
  });

  it("rejects empty responses and unregistered models without silent model fallback", async () => {
    const emptyClient = createMockClient({
      generateContent: vi.fn().mockResolvedValue({ text: "   " })
    });
    const provider = new GeminiProvider({ apiKey: testApiKey, client: emptyClient });

    await expect(
      provider.generate({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    await expect(
      provider.generate({
        model: "unregistered-model",
        messages: [{ role: "user", content: "Hi" }]
      })
    ).rejects.toMatchObject({ code: "INVALID_CONFIG" });
  });

  it("maps auth errors without retrying and redacts API keys", async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error(`API_KEY_INVALID for key ${testApiKey}`), { status: 401 })
      );
    const provider = new GeminiProvider({
      apiKey: testApiKey,
      client: createMockClient({ generateContent }),
      sleepFn: async () => undefined
    });

    try {
      await provider.generate({ messages: [{ role: "user", content: "Hi" }] });
      expect.fail("Expected AUTH_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect((err as AIProviderError).code).toBe("AUTH_ERROR");
      expect((err as AIProviderError).message).not.toContain(testApiKey);
      expect((err as AIProviderError).message).toContain("[REDACTED]");
    }
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("retries transient 503 server errors and rate limits, and handles network errors", async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Service unavailable"), { status: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 }))
      .mockResolvedValueOnce({ text: "Recovered!" });

    const provider = new GeminiProvider({
      apiKey: testApiKey,
      client: createMockClient({ generateContent }),
      sleepFn: async () => undefined
    });

    const res = await provider.generate({ messages: [{ role: "user", content: "Hi" }] });
    expect(res.content).toBe("Recovered!");
    expect(generateContent).toHaveBeenCalledTimes(3);

    const netProvider = new GeminiProvider({
      apiKey: testApiKey,
      client: createMockClient({
        generateContent: vi.fn().mockRejectedValue(new TypeError("fetch failed"))
      }),
      retryPolicy: { maxRetries: 0, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 2 },
      sleepFn: async () => undefined
    });
    await expect(
      netProvider.generate({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("handles timeouts and caller AbortSignal cancellation", async () => {
    const hangingClient = createMockClient({
      generateContent: vi.fn().mockImplementation(async ({ config }) => {
        return new Promise((_resolve, reject) => {
          config?.abortSignal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      })
    });

    const timeoutProvider = new GeminiProvider({
      apiKey: testApiKey,
      timeoutMs: 25,
      client: hangingClient,
      retryPolicy: { maxRetries: 0, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 2 }
    });
    await expect(
      timeoutProvider.generate({ messages: [{ role: "user", content: "Hi" }] })
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    const cancelController = new AbortController();
    const cancelProvider = new GeminiProvider({
      apiKey: testApiKey,
      timeoutMs: 5000,
      client: hangingClient
    });
    const promise = cancelProvider.generate({
      messages: [{ role: "user", content: "Hi" }],
      signal: cancelController.signal
    });
    cancelController.abort();
    await expect(promise).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("retries transient 503 errors on stream open and unwraps nested Gemini JSON error messages", async () => {
    let attempts = 0;
    const nested503 = Object.assign(
      new Error(
        JSON.stringify({
          error: {
            message: JSON.stringify({
              error: {
                code: 503,
                message: "This model is currently experiencing high demand.",
                status: "UNAVAILABLE"
              }
            }),
            code: 503,
            status: "Service Unavailable"
          }
        })
      ),
      { status: 503 }
    );

    const flakyStreamClient = createMockClient({
      generateContentStream: vi.fn().mockImplementation(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw nested503;
        }
        async function* chunks() {
          yield { text: "Recovered response" };
        }
        return chunks();
      })
    });

    const provider = new GeminiProvider({
      apiKey: testApiKey,
      client: flakyStreamClient,
      retryPolicy: { maxRetries: 2, initialDelayMs: 1, maxDelayMs: 5, backoffMultiplier: 2 },
      sleepFn: async () => undefined
    });

    const deltas: string[] = [];
    for await (const evt of provider.stream({ messages: [{ role: "user", content: "Hello" }] })) {
      if (evt.type === "delta") deltas.push(evt.text);
    }
    expect(attempts).toBe(2);
    expect(deltas.join("")).toBe("Recovered response");

    // When retries are exhausted, nested JSON is unwrapped to a readable message
    const always503Client = createMockClient({
      generateContentStream: vi.fn().mockRejectedValue(nested503)
    });
    const noRetryProvider = new GeminiProvider({
      apiKey: testApiKey,
      client: always503Client,
      retryPolicy: { maxRetries: 0, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 2 }
    });

    await expect(async () => {
      for await (const _evt of noRetryProvider.stream({
        messages: [{ role: "user", content: "Hello" }]
      })) {
        // noop
      }
    }).rejects.toThrow("This model is currently experiencing high demand.");
  });
});
