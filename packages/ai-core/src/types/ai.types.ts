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

export interface AIRequest {
  requestId?: string;
  model?: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  timeoutMs?: number;
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
