import type { IntentStatus } from "@codemind/shared";

/**
 * Strict finite state machine for Intent lifecycle transitions.
 * Arbitrary status jumps are rejected deterministically.
 */
export const INTENT_VALID_TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = {
  draft: ["parsing", "cancelled"],
  parsing: ["clarification_required", "ready_for_investigation", "failed", "cancelled"],
  clarification_required: ["ready_for_investigation", "parsing", "cancelled"],
  ready_for_investigation: ["investigating", "clarification_required", "cancelled"],
  investigating: ["analyzing", "failed", "cancelled"],
  analyzing: ["awaiting_review", "failed", "cancelled"],
  awaiting_review: ["approved", "investigating", "analyzing", "completed", "cancelled"],
  approved: ["completed", "awaiting_review", "failed", "cancelled"],
  completed: ["awaiting_review", "investigating"],
  failed: ["ready_for_investigation", "investigating", "analyzing", "cancelled"],
  cancelled: []
};

export class IntentStateTransitionError extends Error {
  public readonly code = "INVALID_INTENT_TRANSITION";
  public readonly from: IntentStatus;
  public readonly to: IntentStatus;

  constructor(from: IntentStatus, to: IntentStatus) {
    super(`Invalid intent status transition from "${from}" to "${to}".`);
    this.name = "IntentStateTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransitionIntentStatus(from: IntentStatus, to: IntentStatus): boolean {
  if (from === to) return true;
  return INTENT_VALID_TRANSITIONS[from].includes(to);
}

export function assertIntentStatusTransition(from: IntentStatus, to: IntentStatus): void {
  if (!canTransitionIntentStatus(from, to)) {
    throw new IntentStateTransitionError(from, to);
  }
}
