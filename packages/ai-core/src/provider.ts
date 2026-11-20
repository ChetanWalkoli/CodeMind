export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIRequest {
  model?: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: string;
  usage?: AIUsage;
}

export type AIStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; response: AIResponse }
  | { type: "error"; message: string };

export interface AIProvider {
  readonly name: string;
  generate(input: AIRequest): Promise<AIResponse>;
  stream(input: AIRequest): AsyncIterable<AIStreamEvent>;
}
