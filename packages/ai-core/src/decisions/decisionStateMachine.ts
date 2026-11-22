import type {
  DecisionEvidence,
  DecisionLifecycleStatus,
  DecisionVerificationState
} from "@codemind/shared";

/**
 * Strict finite state machine for Decision Memory lifecycle statuses (Milestone 7.1).
 * Invalid transitions are rejected deterministically.
 */
export const DECISION_VALID_TRANSITIONS: Record<
  DecisionLifecycleStatus,
  readonly DecisionLifecycleStatus[]
> = {
  proposed: ["accepted", "rejected", "deprecated"],
  accepted: ["superseded", "deprecated"],
  deprecated: ["accepted", "superseded"],
  rejected: ["proposed"],
  superseded: []
};

export class DecisionStateTransitionError extends Error {
  public readonly code = "INVALID_DECISION_TRANSITION";
  public readonly from: DecisionLifecycleStatus;
  public readonly to: DecisionLifecycleStatus;

  constructor(from: DecisionLifecycleStatus, to: DecisionLifecycleStatus) {
    super(`Invalid decision status transition from "${from}" to "${to}".`);
    this.name = "DecisionStateTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransitionDecisionStatus(
  from: DecisionLifecycleStatus,
  to: DecisionLifecycleStatus
): boolean {
  if (from === to) return true;
  return DECISION_VALID_TRANSITIONS[from].includes(to);
}

export function assertDecisionStatusTransition(
  from: DecisionLifecycleStatus,
  to: DecisionLifecycleStatus
): void {
  if (!canTransitionDecisionStatus(from, to)) {
    throw new DecisionStateTransitionError(from, to);
  }
}

/**
 * Computes the overall verification state of a decision from its lifecycle status
 * and current (non-historical) evidence freshness.
 */
export function computeDecisionVerificationState(
  status: DecisionLifecycleStatus,
  evidence: readonly DecisionEvidence[]
): DecisionVerificationState {
  if (status === "superseded") {
    return "superseded";
  }

  const activeEvidence = evidence.filter((e) => !e.isHistorical);
  if (activeEvidence.length === 0) {
    return "unverified";
  }

  let currentCount = 0;
  let staleCount = 0;
  let needsReviewCount = 0;

  for (const item of activeEvidence) {
    if (item.verificationStatus === "current") {
      currentCount += 1;
    } else if (
      item.verificationStatus === "stale" ||
      item.verificationStatus === "partially_stale"
    ) {
      staleCount += 1;
    } else if (item.verificationStatus === "needs_review") {
      needsReviewCount += 1;
    }
  }

  if (staleCount > 0 && currentCount === 0) {
    return "stale";
  }
  if (staleCount > 0 && currentCount > 0) {
    return "partially_stale";
  }
  if (needsReviewCount > 0) {
    return "needs_review";
  }
  if (currentCount > 0) {
    return "current";
  }
  return "unverified";
}
