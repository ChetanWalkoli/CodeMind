import type { AIModelLifecycle } from "@codemind/shared";
import type { AIProviderId } from "../types/ai.types.js";

export interface ModelConfig {
  id: string;
  provider: AIProviderId;
  displayName: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  freeTierAvailable: boolean;
  lifecycleStatus: AIModelLifecycle;
  supportsJsonMode: boolean;
  supportsStreaming: boolean;
}

/**
 * Centralized Google Gemini Developer API model catalog.
 * Only registers currently active Gemini Developer API models (retired 2.5 models removed).
 */
export const MODEL_CATALOG: readonly ModelConfig[] = [
  {
    id: "gemini-3.8-flash",
    provider: "gemini",
    displayName: "Gemini 3.8 Flash",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    freeTierAvailable: true,
    lifecycleStatus: "active",
    supportsJsonMode: true,
    supportsStreaming: true
  },
  {
    id: "gemini-3.6-flash",
    provider: "gemini",
    displayName: "Gemini 3.6 Flash",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    freeTierAvailable: true,
    lifecycleStatus: "active",
    supportsJsonMode: true,
    supportsStreaming: true
  },
  {
    id: "gemini-3.1-flash-lite",
    provider: "gemini",
    displayName: "Gemini 3.1 Flash-Lite",
    contextWindowTokens: 1_048_576,
    maxOutputTokens: 65_536,
    freeTierAvailable: true,
    lifecycleStatus: "active",
    supportsJsonMode: true,
    supportsStreaming: true
  }
] as const;

export const DEFAULT_MODEL_BY_PROVIDER: Record<AIProviderId, string> = {
  gemini: "gemini-3.8-flash"
};

export function getModelConfig(modelId: string): ModelConfig | null {
  return MODEL_CATALOG.find((m) => m.id === modelId) ?? null;
}

export function listModelsForProvider(provider: AIProviderId): ModelConfig[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider);
}
