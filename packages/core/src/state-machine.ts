/**
 * Deterministic payment state machine runner.
 *
 * Uses the transition table from `@mova/types` (pure data). The runner is the
 * ONLY component that advances a payment's state, and it enforces guards from
 * deterministic data (validation result, compliance/risk decisions, approval
 * threshold, settlement confirmation). The LLM cannot move a payment's state.
 */
import {
  findTransition,
  isTerminalState,
  type PaymentEvent,
  type PaymentFailureCode,
  type PaymentGuard,
  type PaymentGuardContext,
  type PaymentState,
} from "@mova/types";

export interface TransitionOutcome {
  ok: boolean;
  from: PaymentState;
  event: PaymentEvent;
  to: PaymentState | null;
  /** Set when ok === false (guard failed or no transition). */
  reason: string | null;
  /** Set when the transition lands in FAILED. */
  failureCode: PaymentFailureCode | null;
}

const GUARDS: Readonly<Record<PaymentGuard, (ctx: PaymentGuardContext) => boolean>> = {
  always: () => true,
  intentValidated: (ctx) => ctx.hasValidatedIntent,
  complianceNotBlocked: (ctx) => ctx.complianceDecision !== "BLOCK",
  riskNotBlocked: (ctx) => ctx.riskDecision !== "BLOCK",
  approvalsMet: (ctx) => ctx.approvalsMet,
  settlementConfirmed: (ctx) => ctx.settlementConfirmed,
};

export class PaymentStateMachine {
  constructor(private readonly context: PaymentGuardContext) {}

  /** True if the guard for a transition passes. */
  private guardPasses(guard: PaymentGuard): boolean {
    return GUARDS[guard](this.context);
  }

  /**
   * Attempt `event` from `from`. Returns the outcome; does NOT mutate anything.
   * Callers persist the new state and an audit event on `ok === true`.
   */
  apply(from: PaymentState, event: PaymentEvent): TransitionOutcome {
    if (isTerminalState(from)) {
      return {
        ok: false,
        from,
        event,
        to: null,
        reason: `cannot transition from terminal state ${from}`,
        failureCode: null,
      };
    }

    const transition = findTransition(from, event);
    if (!transition) {
      return {
        ok: false,
        from,
        event,
        to: null,
        reason: `no transition for event ${event} from ${from}`,
        failureCode: null,
      };
    }

    if (!this.guardPasses(transition.guard)) {
      return {
        ok: false,
        from,
        event,
        to: null,
        reason: `guard '${transition.guard}' failed for ${from} -> ${transition.to}`,
        failureCode: null,
      };
    }

    return {
      ok: true,
      from,
      event,
      to: transition.to,
      reason: null,
      failureCode: transition.failureCode ?? null,
    };
  }
}
