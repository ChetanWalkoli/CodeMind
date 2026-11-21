import type { AIUsage } from "../types/ai.types.js";

export interface ModelPricingEntry {
  readonly modelId: string;
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
  readonly lastVerified: string;
}

/**
 * Centralized pricing registry.
 * Intentionally contains no fabricated Gemini pricing or free-tier billing figures;
 * callers may supply explicit pricing entries when billing estimation is desired.
 */
export const MODEL_PRICING_CATALOG: Readonly<Record<string, ModelPricingEntry>> = {};

export interface CostEstimateResult {
  readonly modelId: string;
  readonly pricingAvailable: boolean;
  readonly estimatedUsd: number | null;
  readonly isEstimate: true;
}

export function estimateRequestCostUsd(
  modelId: string,
  usage: Pick<AIUsage, "inputTokens" | "outputTokens">,
  pricingTable: Readonly<Record<string, ModelPricingEntry>> = MODEL_PRICING_CATALOG
): CostEstimateResult {
  const pricing = pricingTable[modelId];
  if (!pricing) {
    return {
      modelId,
      pricingAvailable: false,
      estimatedUsd: null,
      isEstimate: true
    };
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens;
  const estimatedUsd = Number((inputCost + outputCost).toFixed(6));

  return {
    modelId,
    pricingAvailable: true,
    estimatedUsd,
    isEstimate: true
  };
}
