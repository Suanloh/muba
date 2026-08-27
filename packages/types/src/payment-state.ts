/**
 * MOVA payment state machine — canonical lifecycle.
 *
 * States (from the Phase 0 spec):
 *   CREATED → PARSED → ROUTE_FOUND → COMPLIANCE_CHECKED → RISK_ASSESSED
 *   → AWAITING_APPROVAL → APPROVED → EXECUTING → SETTLED | FAILED
 *
 * This module is PURE DATA + types. The deterministic runner (guards, apply)
 * lives in `@mova/core` (`state-machine.ts`). No LLM ever writes a state.
 */
import type { ComplianceDecision, RiskDecision } from "./enums.js";

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export const PAYMENT_STATES = [
  "CREATED",
  "PARSED",
  "ROUTE_FOUND",
  "COMPLIANCE_CHECKED",
  "RISK_ASSESSED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "SETTLED",
  "FAILED",
] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];

/** Terminal states — no further transitions are allowed. */
export const TERMINAL_STATES: readonly PaymentState[] = ["SETTLED", "FAILED"];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const PAYMENT_EVENTS = [
  "INTENT_CREATED",
  "INTENT_PARSED",
  "VALIDATION_FAILED",
  "ROUTE_FOUND",
  "ROUTING_FAILED",
  "COMPLIANCE_CHECKED",
  "COMPLIANCE_BLOCKED",
  "RISK_ASSESSED",
  "RISK_BLOCKED",
  "APPROVAL_REQUESTED",
  "APPROVED",
  "APPROVAL_REJECTED",
  "APPROVAL_EXPIRED",
  "CANCELLED",
  "EXECUTION_STARTED",
  "EXECUTION_SIMULATION_FAILED",
  "SETTLED",
  "EXECUTION_FAILED",
] as const;

export type PaymentEvent = (typeof PAYMENT_EVENTS)[number];

// ---------------------------------------------------------------------------
// Guards & failure codes
// ---------------------------------------------------------------------------

/**
 * Deterministic preconditions checked before a transition is allowed.
 * All data comes from the deterministic engines / approval service — never
 * from LLM claims.
 */
export type PaymentGuard =
  | "always"
  | "intentValidated"
  | "complianceNotBlocked"
  | "riskNotBlocked"
  | "approvalsMet"
  | "settlementConfirmed";

/** Why a payment moved to FAILED. Attached to the audit event + intent. */
export type PaymentFailureCode =
  | "VALIDATION_FAILED"
  | "ROUTING_FAILED"
  | "COMPLIANCE_BLOCKED"
  | "RISK_BLOCKED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "CANCELLED"
  | "EXECUTION_SIMULATION_FAILED"
  | "EXECUTION_FAILED"
  | "INTERNAL_ERROR";

export interface PaymentTransition {
  event: PaymentEvent;
  to: PaymentState;
  guard: PaymentGuard;
  /** Present only on transitions that land in FAILED. */
  failureCode?: PaymentFailureCode;
}

// ---------------------------------------------------------------------------
// Transition table (source state -> allowed transitions)
// ---------------------------------------------------------------------------

export const PAYMENT_TRANSITIONS: Readonly<Record<PaymentState, readonly PaymentTransition[]>> = {
  CREATED: [
    { event: "INTENT_PARSED", to: "PARSED", guard: "intentValidated" },
    { event: "VALIDATION_FAILED", to: "FAILED", guard: "always", failureCode: "VALIDATION_FAILED" },
    { event: "CANCELLED", to: "FAILED", guard: "always", failureCode: "CANCELLED" },
  ],
  PARSED: [
    { event: "ROUTE_FOUND", to: "ROUTE_FOUND", guard: "always" },
    { event: "ROUTING_FAILED", to: "FAILED", guard: "always", failureCode: "ROUTING_FAILED" },
    { event: "CANCELLED", to: "FAILED", guard: "always", failureCode: "CANCELLED" },
  ],
  ROUTE_FOUND: [
    { event: "COMPLIANCE_CHECKED", to: "COMPLIANCE_CHECKED", guard: "always" },
    { event: "CANCELLED", to: "FAILED", guard: "always", failureCode: "CANCELLED" },
  ],
  COMPLIANCE_CHECKED: [
    { event: "RISK_ASSESSED", to: "RISK_ASSESSED", guard: "complianceNotBlocked" },
    { event: "COMPLIANCE_BLOCKED", to: "FAILED", guard: "always", failureCode: "COMPLIANCE_BLOCKED" },
    { event: "CANCELLED", to: "FAILED", guard: "always", failureCode: "CANCELLED" },
  ],
  RISK_ASSESSED: [
    { event: "APPROVAL_REQUESTED", to: "AWAITING_APPROVAL", guard: "riskNotBlocked" },
    { event: "RISK_BLOCKED", to: "FAILED", guard: "always", failureCode: "RISK_BLOCKED" },
    { event: "CANCELLED", to: "FAILED", guard: "always", failureCode: "CANCELLED" },
  ],
  AWAITING_APPROVAL: [
    { event: "APPROVED", to: "APPROVED", guard: "approvalsMet" },
    { event: "APPROVAL_REJECTED", to: "FAILED", guard: "always", failureCode: "APPROVAL_REJECTED" },
    { event: "APPROVAL_EXPIRED", to: "FAILED", guard: "always", failureCode: "APPROVAL_EXPIRED" },
    { event: "CANCELLED", to: "FAILED", guard: "always", failureCode: "CANCELLED" },
  ],
  APPROVED: [
    { event: "EXECUTION_STARTED", to: "EXECUTING", guard: "always" },
    { event: "EXECUTION_SIMULATION_FAILED", to: "FAILED", guard: "always", failureCode: "EXECUTION_SIMULATION_FAILED" },
    { event: "CANCELLED", to: "FAILED", guard: "always", failureCode: "CANCELLED" },
  ],
  EXECUTING: [
    { event: "SETTLED", to: "SETTLED", guard: "settlementConfirmed" },
    { event: "EXECUTION_FAILED", to: "FAILED", guard: "always", failureCode: "EXECUTION_FAILED" },
  ],
  SETTLED: [],
  FAILED: [],
} as const;

// ---------------------------------------------------------------------------
// Guard inputs (computed by deterministic code, passed to the runner)
// ---------------------------------------------------------------------------

export interface PaymentGuardContext {
  /** ParsedIntent.validationStatus === "VALIDATED". */
  hasValidatedIntent: boolean;
  /** ComplianceAssessment.decision (null until compliance ran). */
  complianceDecision: ComplianceDecision | null;
  /** RiskAssessment.decision (null until risk ran). */
  riskDecision: RiskDecision | null;
  /** ApprovalRequest.thresholdMet. */
  approvalsMet: boolean;
  /** Real digest received (or simulated-mode confirmation recorded). */
  settlementConfirmed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isTerminalState(state: PaymentState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Allowed transitions out of `from` for a given event (0 or 1). */
export function findTransition(
  from: PaymentState,
  event: PaymentEvent,
): PaymentTransition | null {
  return PAYMENT_TRANSITIONS[from].find((t) => t.event === event) ?? null;
}
