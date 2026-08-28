/**
 * MOVA Phase 8 — txn Status, Audit Trail & Trust Layer types.
 *
 * Pure data shapes that make a payment traceable from user intent to final
 * settlement:
 *
 *   - `PaymentStatusStep`  — one lifecycle state reached, with WHO/WHEN/WHY
 *     (derived deterministically from the append-only audit event stream).
 *   - `PaymentAuditEntry`  — one audited decision (intent parse, route
 *     selection, compliance, risk, hedge, approval, execution), carrying the
 *     deterministic payload for expansion.
 *   - `PaymentAuditTrail`  — the per-correlation decision log + status
 *     timeline. Never produced by an LLM: it is a projection of `AuditEvent`s
 *     emitted by the deterministic engines and the approval service.
 *   - `PaymentExplanation` — the Phase 8 human-facing answers to: what MOVA
 *     understood, why this route, which compliance checks passed, why hedging,
 *     what the user approved, and what happened on-chain.
 *
 * Trust rule: the audit trail is a PROJECTION of immutable `AuditEvent`s. The
 * trace builders never fabricate a decision — if an engine didn't emit an
 * event, the trail simply doesn't claim it.
 */
import type {
  ComplianceDecision,
  HedgeDataSource,
  HedgeDecision,
  HedgingStrategy,
  IntentAction,
  Money,
  Network,
  RecipientType,
  RiskBand,
  RiskDecision,
} from "./enums.js";
import type { RouteSavings } from "./domain.js";
import type { PaymentEvent, PaymentState } from "./payment-state.js";

// ---------------------------------------------------------------------------
// Audit trail stages — the logical decision points of one payment flow
// ---------------------------------------------------------------------------

/** Logical decision groups the audit UI organizes events into. */
export type PaymentAuditStage =
  | "INTENT_CREATED" // the original natural-language request
  | "INTENT_PARSED" // what MOVA understood (validated intent)
  | "ROUTE" // route candidates + selected route + cost calculation
  | "COMPLIANCE" // screening / policy verdict
  | "RISK" // financial risk assessment
  | "HEDGE" // hedging decision (route vs route+hedge)
  | "APPROVAL" // human approval / rejection / expiry
  | "EXECUTION"; // wallet authz → execution → settlement

/** Ordered, canonical display order of audit stages. */
export const PAYMENT_AUDIT_STAGES: readonly PaymentAuditStage[] = [
  "INTENT_CREATED",
  "INTENT_PARSED",
  "ROUTE",
  "COMPLIANCE",
  "RISK",
  "HEDGE",
  "APPROVAL",
  "EXECUTION",
];

// ---------------------------------------------------------------------------
// txn Status — one lifecycle step
// ---------------------------------------------------------------------------

/** One lifecycle state reached, with who/when/why (from an audit event). */
export interface PaymentStatusStep {
  /** The state that was entered by this transition. */
  state: PaymentState;
  /** Human label for the state, e.g. "Awaiting approval". */
  label: string;
  /** The audit event that caused the transition. */
  event: PaymentEvent | string;
  /** Actor display (owner address, "system", "approver", …). */
  actor: string;
  /** Epoch ms of the transition. */
  at: number;
  /** True when the transition was driven by a simulated/mock engine. */
  simulated: boolean;
  /** Optional one-line detail (e.g. failure code). */
  detail: string | null;
}

// ---------------------------------------------------------------------------
// Audit trail — decision log
// ---------------------------------------------------------------------------

/** One audited decision, projected from an `AuditEvent`. */
export interface PaymentAuditEntry {
  id: string;
  stage: PaymentAuditStage;
  /** Human label for the stage, e.g. "Route selection". */
  label: string;
  /** The raw event type, e.g. "ROUTE_FOUND". */
  eventType: string;
  actor: { type: string; id: string };
  at: number;
  simulated: boolean;
  /** Short verdict, e.g. "ALLOW", "APPROVED", "SETTLED", "FAILED". */
  outcome: string;
  /** One-line human summary of the decision. */
  detail: string;
  /** The immutable deterministic payload (route data, scores, authz, …). */
  data: unknown;
}

/** The full per-correlation audit trail (status timeline + decision log). */
export interface PaymentAuditTrail {
  correlationId: string;
  /** Payment record id (first event's entityId, if any). */
  recordId: string | null;
  statusSteps: PaymentStatusStep[];
  entries: PaymentAuditEntry[];
  /** Current (or terminal) lifecycle state, from the last step. */
  currentState: PaymentState | null;
  /** True when the flow reached a terminal state (SETTLED/FAILED). */
  terminal: boolean;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Payment explanation — the 6 questions a user must be able to answer
// ---------------------------------------------------------------------------

/** The Phase 8 unified, human-readable payment explanation. */
export interface PaymentExplanation {
  recordId: string;
  correlationId: string;
  /** Current lifecycle state. */
  status: PaymentState;
  createdAt: number;

  /** 1 — What did MOVA understand? */
  understood: {
    rawText: string;
    action: IntentAction;
    amount: Money;
    recipient: { type: RecipientType; value: string; name: string | null };
    network: Network;
    memo: string | null;
  };

  /** 2 — Why did it select this route? */
  route: {
    routeNo: number;
    routeId: string;
    legOrder: string[];
    fees: Money;
    totalEstimatedCost: Money;
    estimatedTimeMs: number;
    reliability: number;
    selectionReason: string;
    candidateCount: number;
    savings: RouteSavings | null;
    totalCost: Money;
  };

  /** 3 — Which compliance checks passed? */
  compliance: {
    decision: ComplianceDecision;
    riskScore: number;
    failClosed: boolean;
    matchedLists: string[];
    checks: string[];
    explanation: string;
  };

  /** 4 — Why was hedging used? */
  risk: {
    band: RiskBand;
    score: number;
    decision: RiskDecision;
    topSignals: { description: string; value: string; threshold: string }[];
    explanation: string;
  };

  /** 4 — Why was hedging used? (the hedge decision itself) */
  hedge: {
    decision: HedgeDecision;
    recommended: boolean;
    strategy: HedgingStrategy;
    premium: Money;
    exposureReduction: Money;
    dataSource: HedgeDataSource;
    explanation: string;
  };

  /** 5 — What did the user approve? */
  approval: {
    status: string;
    decision: string | null;
    approvedAt: number | null;
    planDigest: string;
    authzNonce: string | null;
    expiresAt: number;
  };

  /** 6 — What happened on-chain? */
  onChain: {
    expectedSettlement: "REAL" | "SIMULATED";
    status: string | null;
    txDigest: string | null;
    simulated: boolean | null;
    signedBy: string | null;
    signedAt: number | null;
    error: string | null;
  };
}
