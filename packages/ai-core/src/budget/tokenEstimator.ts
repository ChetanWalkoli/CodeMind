import type { AIMessage } from "../types/ai.types.js";

/**
 * Replaceable token estimation interface.
 * Implementations MUST accurately set `isExact` (`false` for heuristic estimators,
 * `true` only for exact model-specific BPE tokenizers).
 */
export interface TokenEstimator {
  readonly id: string;
  readonly isExact: boolean;
  estimateText(text: string): number;
  estimateMessages(messages: readonly AIMessage[]): number;
}

const MESSAGE_OVERHEAD_TOKENS = 4;
const CONVERSATION_PRIMER_TOKENS = 2;

// Matches identifiers/words, numbers, multi-char whitespace/newlines, or individual punctuation/symbols
const LEXEME_PATTERN = /[A-Za-z_][A-Za-z0-9_]*|\d+|\r?\n|[^\sA-Za-z0-9_]/g;

/**
 * Conservative, deterministic heuristic token estimator calibrated for source code and prose.
 *
 * Strategy:
 * - Source code (punctuation, brackets, operators, short identifiers, JSON/TSX) typically
 *   tokenizes denser (~2.5–3.0 chars/token in o200k/cl100k BPE) than English prose (~4 chars/token).
 * - Computes two estimates and takes the conservative maximum:
 *   1. Character-density estimate: 2.8 chars/token when symbol density > 10%, else 3.4 chars/token.
 *   2. Lexeme-boundary estimate: counts identifiers (long identifiers split every 6 chars),
 *      numeric literals, newlines, and individual punctuation/operator tokens.
 * - Adds chat-framing overhead (4 tokens per message + 2 reply-primer tokens).
 *
 * IMPORTANT: Always reports `isExact: false`. Never describe heuristic values as exact token counts.
 */
export class HeuristicTokenEstimator implements TokenEstimator {
  public readonly id = "heuristic-code-v2";
  public readonly isExact = false;

  public estimateText(text: string): number {
    if (!text) return 0;

    let symbolCount = 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      const isAlphaNumOrSpace =
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 32;
      if (!isAlphaNumOrSpace) {
        symbolCount += 1;
      }
    }

    const density = symbolCount / text.length;
    const charsPerToken = density > 0.1 ? 2.8 : 3.4;
    const charEstimate = Math.ceil(text.length / charsPerToken);

    let lexemeEstimate = 0;
    for (const match of text.matchAll(LEXEME_PATTERN)) {
      const token = match[0];
      if (token.length > 6 && /^[A-Za-z0-9_]+$/.test(token)) {
        lexemeEstimate += Math.ceil(token.length / 6);
      } else {
        lexemeEstimate += 1;
      }
    }

    return Math.max(charEstimate, lexemeEstimate);
  }

  public estimateMessages(messages: readonly AIMessage[]): number {
    if (messages.length === 0) return 0;
    let total = CONVERSATION_PRIMER_TOKENS;
    for (const msg of messages) {
      total += MESSAGE_OVERHEAD_TOKENS + this.estimateText(msg.content);
    }
    return total;
  }
}

export const defaultTokenEstimator: TokenEstimator = new HeuristicTokenEstimator();
