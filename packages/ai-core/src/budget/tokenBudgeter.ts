import type {
  AIContextSnapshot,
  AITokenBudgetSummary,
  ContextExcludedItem,
  ContextItem
} from "@codemind/shared";
import { rankContextCandidates } from "../context/ranking.js";
import { AIProviderError } from "../errors/aiError.js";
import { getModelConfig, type ModelConfig } from "../models/catalog.js";
import { wrapUntrustedFileContext } from "../prompts/injectionBoundary.js";
import { composePromptMessages } from "../prompts/promptComposer.js";
import type { AIMessage } from "../types/ai.types.js";
import { defaultTokenEstimator, type TokenEstimator } from "./tokenEstimator.js";

export interface ConversationHistoryInput {
  messages: readonly AIMessage[];
  maxHistoryTokens?: number;
}

export interface TokenBudgetOptions {
  modelId: string;
  modelConfigOverride?: ModelConfig;
  reservedOutputTokens?: number;
  safetyMarginRatio?: number;
  safetyMarginTokens?: number;
  maxContextTokens?: number;
  history?: ConversationHistoryInput;
  estimator?: TokenEstimator;
}

export interface OmittedContextReport {
  filePath: string;
  reason: "token-budget-exceeded";
  relevanceScore: number;
  estimatedTokens: number;
}

export interface TruncatedContextReport {
  filePath: string;
  originalEndLine: number;
  truncatedEndLine: number;
  estimatedTokens: number;
}

export interface BudgetedContextResult {
  snapshot: AIContextSnapshot;
  messages: AIMessage[];
  allocation: AITokenBudgetSummary;
  omittedItems: OmittedContextReport[];
  truncatedItems: TruncatedContextReport[];
  historyIncluded: AIMessage[];
  historyOmittedCount: number;
}

const DEFAULT_RESERVED_OUTPUT_TOKENS = 4096;
const DEFAULT_SAFETY_MARGIN_RATIO = 0.1;
const MIN_TRUNCATED_ITEM_TOKENS = 48;

function resolveModelConfig(modelId: string, override?: ModelConfig): ModelConfig {
  if (override) {
    return override;
  }
  const found = getModelConfig(modelId);
  if (!found) {
    throw new AIProviderError(
      "INVALID_CONFIG",
      `Unsupported model "${modelId}" for token budgeting.`,
      { retryable: false }
    );
  }
  return found;
}

/**
 * Truncates a ContextItem strictly on whole-line boundaries (never mid-line)
 * using binary search (O(log N)) so its wrapped representation fits within `maxTokens`.
 */
function truncateItemOnLineBoundary(
  item: ContextItem,
  maxTokens: number,
  estimator: TokenEstimator
): ContextItem | null {
  const lines = item.content.split(/\r?\n/);
  if (lines.length === 0) return null;

  const fitsCount = (count: number): boolean => {
    const candidateText = lines.slice(0, count).join("\n");
    const candidateItem: ContextItem = {
      ...item,
      endLine: item.startLine + count - 1,
      content: candidateText,
      truncated: true
    };
    return estimator.estimateText(wrapUntrustedFileContext(candidateItem)) <= maxTokens;
  };

  if (!fitsCount(1)) {
    return null;
  }

  let low = 1;
  let high = lines.length;
  let best = 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fitsCount(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const finalText = lines.slice(0, best).join("\n");
  const finalEndLine = item.startLine + best - 1;
  return {
    ...item,
    id: `${item.filePath}:${item.startLine}-${finalEndLine}`,
    endLine: finalEndLine,
    content: finalText,
    byteLength: Buffer.byteLength(finalText, "utf8"),
    estimatedTokens: estimator.estimateText(finalText),
    truncated: true
  };
}

/**
 * Model-aware, deterministic token budgeter.
 *
 * Priority order:
 * 1. Mandatory system instructions
 * 2. Current user question
 * 3. Optional conversation history (oldest trimmed first)
 * 4. Most relevant source context (complete snippets preferred; low-relevance omitted first;
 *    line-boundary truncation only when needed)
 */
export function budgetContextForModel(
  snapshot: AIContextSnapshot,
  options: TokenBudgetOptions
): BudgetedContextResult {
  const estimator = options.estimator ?? defaultTokenEstimator;
  const model = resolveModelConfig(options.modelId, options.modelConfigOverride);

  const requestedOutput =
    options.reservedOutputTokens ?? Math.min(DEFAULT_RESERVED_OUTPUT_TOKENS, model.maxOutputTokens);
  const reservedOutputTokens = Math.max(1, Math.min(requestedOutput, model.maxOutputTokens));

  const safetyMarginRatio = Math.max(
    0,
    Math.min(options.safetyMarginRatio ?? DEFAULT_SAFETY_MARGIN_RATIO, 0.5)
  );
  const safetyMarginTokens =
    options.safetyMarginTokens !== undefined
      ? Math.max(0, options.safetyMarginTokens)
      : Math.ceil(model.contextWindowTokens * safetyMarginRatio);

  const maxInputTokens = model.contextWindowTokens - reservedOutputTokens - safetyMarginTokens;
  if (maxInputTokens <= 0) {
    throw new AIProviderError(
      "INVALID_CONFIG",
      `Model "${model.id}" context window (${model.contextWindowTokens}) cannot accommodate reserved output (${reservedOutputTokens}) and safety margin (${safetyMarginTokens}).`,
      { provider: model.provider, retryable: false }
    );
  }

  // Measure mandatory system prompt + user query framing (with zero repository items)
  const emptySnapshot: AIContextSnapshot = {
    ...snapshot,
    items: [],
    totalBytes: 0,
    estimatedTokens: 0
  };
  const baseMessages = composePromptMessages(emptySnapshot);
  const systemMessage = baseMessages[0]!;
  const baseUserMessage = baseMessages[1]!;

  const systemTokens = estimator.estimateMessages([systemMessage]);
  const userQueryTokens = estimator.estimateMessages([baseUserMessage]);
  const mandatoryTokens = systemTokens + userQueryTokens;

  if (mandatoryTokens > maxInputTokens) {
    throw new AIProviderError(
      "INVALID_REQUEST",
      `System instructions and user prompt (~${mandatoryTokens} estimated tokens) exceed the input token budget (${maxInputTokens}) for model "${model.id}". Shorten your prompt or select a model with a larger context window.`,
      { provider: model.provider, retryable: false }
    );
  }

  // Budget optional conversation history (future multi-turn interface), keeping most recent turns
  const historyIncluded: AIMessage[] = [];
  let historyTokens = 0;
  let historyOmittedCount = 0;

  if (options.history && options.history.messages.length > 0) {
    const remainingForHistory = maxInputTokens - mandatoryTokens;
    const historyCap = Math.min(
      options.history.maxHistoryTokens ?? Math.floor(remainingForHistory * 0.25),
      remainingForHistory
    );

    const reversedKept: AIMessage[] = [];
    for (let i = options.history.messages.length - 1; i >= 0; i -= 1) {
      const msg = options.history.messages[i]!;
      const msgTokens = estimator.estimateMessages([msg]);
      if (historyTokens + msgTokens <= historyCap) {
        reversedKept.push(msg);
        historyTokens += msgTokens;
      } else {
        historyOmittedCount += i + 1;
        break;
      }
    }
    historyIncluded.push(...reversedKept.reverse());
  }

  const rawAvailableContextTokens = Math.max(0, maxInputTokens - mandatoryTokens - historyTokens);
  const availableContextTokens =
    options.maxContextTokens !== undefined
      ? Math.min(rawAvailableContextTokens, Math.max(0, options.maxContextTokens))
      : rawAvailableContextTokens;

  // Deterministic prioritization of repository context items
  const rankedItems = rankContextCandidates(snapshot.items);
  const selectedItems: ContextItem[] = [];
  const omittedItems: OmittedContextReport[] = [];
  const truncatedItems: TruncatedContextReport[] = [];
  let usedContextTokens = 0;

  for (const item of rankedItems) {
    const refLineOverhead = estimator.estimateText(
      `[99] ${item.filePath}:${item.startLine}-${item.endLine} (${item.reasons.join(", ")})\n`
    );
    const wrappedFullTokens =
      estimator.estimateText(wrapUntrustedFileContext(item)) + refLineOverhead + 2;

    if (usedContextTokens + wrappedFullTokens <= availableContextTokens) {
      selectedItems.push({
        ...item,
        estimatedTokens: estimator.estimateText(item.content)
      });
      usedContextTokens += wrappedFullTokens;
      continue;
    }

    // Budget exceeded: attempt whole-line boundary truncation only if meaningful space remains
    const remainingContextTokens = availableContextTokens - usedContextTokens - refLineOverhead - 2;
    if (remainingContextTokens >= MIN_TRUNCATED_ITEM_TOKENS) {
      const truncated = truncateItemOnLineBoundary(item, remainingContextTokens, estimator);
      if (truncated) {
        const truncWrappedTokens =
          estimator.estimateText(wrapUntrustedFileContext(truncated)) + refLineOverhead + 2;
        if (usedContextTokens + truncWrappedTokens <= availableContextTokens) {
          selectedItems.push(truncated);
          usedContextTokens += truncWrappedTokens;
          truncatedItems.push({
            filePath: item.filePath,
            originalEndLine: item.endLine,
            truncatedEndLine: truncated.endLine,
            estimatedTokens: truncated.estimatedTokens
          });
          continue;
        }
      }
    }

    omittedItems.push({
      filePath: item.filePath,
      reason: "token-budget-exceeded",
      relevanceScore: item.relevanceScore,
      estimatedTokens: estimator.estimateText(item.content)
    });
  }

  const buildMessagesForItems = (
    items: ContextItem[]
  ): {
    snapshot: AIContextSnapshot;
    messages: AIMessage[];
    totalEstimatedInputTokens: number;
  } => {
    const mergedExcluded: ContextExcludedItem[] = [
      ...snapshot.excluded,
      ...omittedItems.map((o) => ({
        filePath: o.filePath,
        reason: "token-budget-exceeded" as const
      }))
    ];

    const candidateSnapshot: AIContextSnapshot = {
      ...snapshot,
      items,
      excluded: mergedExcluded,
      totalBytes: items.reduce((sum, i) => sum + i.byteLength, 0),
      estimatedTokens: items.reduce((sum, i) => sum + i.estimatedTokens, 0)
    };

    const composed = composePromptMessages(candidateSnapshot);
    const messages: AIMessage[] =
      historyIncluded.length > 0 ? [composed[0]!, ...historyIncluded, composed[1]!] : composed;

    return {
      snapshot: candidateSnapshot,
      messages,
      totalEstimatedInputTokens: estimator.estimateMessages(messages)
    };
  };

  // Verify the COMPLETE composed provider request (system + history + user + references + framing)
  // strictly fits within `maxInputTokens`. Trim lowest-relevance items if framing pushed it over.
  let assembled = buildMessagesForItems(selectedItems);
  while (assembled.totalEstimatedInputTokens > maxInputTokens && selectedItems.length > 0) {
    const dropped = selectedItems.pop()!;
    omittedItems.push({
      filePath: dropped.filePath,
      reason: "token-budget-exceeded",
      relevanceScore: dropped.relevanceScore,
      estimatedTokens: dropped.estimatedTokens
    });
    const truncIdx = truncatedItems.findIndex((t) => t.filePath === dropped.filePath);
    if (truncIdx >= 0) {
      truncatedItems.splice(truncIdx, 1);
    }
    assembled = buildMessagesForItems(selectedItems);
  }

  const finalUsedContextTokens = Math.max(
    0,
    assembled.totalEstimatedInputTokens - mandatoryTokens - historyTokens
  );

  const allocation: AITokenBudgetSummary = {
    modelId: model.id,
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    reservedOutputTokens,
    safetyMarginTokens,
    maxInputTokens,
    systemTokens,
    userQueryTokens,
    historyTokens,
    availableContextTokens,
    usedContextTokens: finalUsedContextTokens,
    totalEstimatedInputTokens: assembled.totalEstimatedInputTokens,
    estimatorId: estimator.id,
    isExactEstimate: estimator.isExact
  };

  const budgetedSnapshot: AIContextSnapshot = {
    ...assembled.snapshot,
    budget: allocation
  };

  return {
    snapshot: budgetedSnapshot,
    messages: assembled.messages,
    allocation,
    omittedItems,
    truncatedItems,
    historyIncluded,
    historyOmittedCount
  };
}
