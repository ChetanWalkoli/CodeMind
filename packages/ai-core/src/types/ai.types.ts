import { z } from "zod";

export const AIProviderIdSchema = z.enum(["gemini"]);
export type AIProviderId = z.infer<typeof AIProviderIdSchema>;

export const AIMessageRoleSchema = z.enum(["system", "user", "assistant"]);
export type AIMessageRole = z.infer<typeof AIMessageRoleSchema>;

export const AIMessageSchema = z.object({
  role: AIMessageRoleSchema,
  content: z.string()
});

export type AIMessage = z.infer<typeof AIMessageSchema>;

export interface AITimeoutPolicy {
  /** Max duration for local context verification and budgeting before contacting the provider. */
  contextPrepTimeoutMs: number;
  /** Max duration waiting for the initial HTTP connection / stream open. */
  connectionTimeoutMs: number;
  /** Max duration waiting for the first response event after connection opens (covers model reasoning/TTFT). */
  firstResponseTimeoutMs: number;
  /** Max inactivity gap between consecutive stream events once streaming is underway. */
  streamIdleTimeoutMs: number;
  /** Hard upper bound for total generation duration across the entire request. */
  overallTimeoutMs: number;
}

export const DEFAULT_TIMEOUT_POLICY: AITimeoutPolicy = {
  contextPrepTimeoutMs: 15_000,
  connectionTimeoutMs: 20_000,
  firstResponseTimeoutMs: 45_000,
  streamIdleTimeoutMs: 25_000,
  overallTimeoutMs: 120_000
};

export interface AIRequest {
  requestId?: string;
  model?: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  timeoutMs?: number;
  timeouts?: Partial<AITimeoutPolicy>;
  signal?: AbortSignal;
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: string;
  finishReason?: string | null;
  usage?: AIUsage;
  retryCount?: number;
}

export type AIStreamEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; usage: AIUsage }
  | { type: "done"; response: AIResponse }
  | { type: "error"; message: string; code?: string };

export interface AIProvider {
  readonly id: AIProviderId;
  readonly name: string;
  readonly defaultModel: string;
  generate(input: AIRequest): Promise<AIResponse>;
  stream(input: AIRequest): AsyncIterable<AIStreamEvent>;
}
