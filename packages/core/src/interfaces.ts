/**
 * MOVA module contracts — the interfaces between modules.
 *
 * These are the ONLY way modules talk to each other. Layering rules
 * (see docs/architecture.md):
 * - The AI layer appears ONLY as `IntentParser` and produces *proposals*.
 * - Every engine is deterministic and never imports execution/approval code.
 * - Value movement happens only via `ExecutionService` → `SettlementProvider`
 *   after a human approval gate.
 * - All decisions are recorded through `AuditService` (append-only).
 */
import type {
  ApprovalDecision,
  ApprovalLevel,
  ApprovalRequest,
  AuditEvent,
  ComplianceAssessment,
  HedgingPlan,
  Money,
  Network,
  ParsedIntent,
  ParsedIntentProposal,
  PaymentIntent,
  PaymentRecommendation,
  QrDecoded,
  RiskAssessment,
  Route,
  RouteCandidate,
  RouteHedgeComparison,
  RouteOptimizationResult,
  RoutePreferenceWeights,
  SelectionCriterion,
  SettlementTransaction,
  SimulationResult,
  Wallet,
} from "@mova/types";
import type {
  HedgingProvider,
  MarketDataProvider,
  ScreeningProvider,
  SettlementProvider,
} from "@mova/integrations";

// ---------------------------------------------------------------------------
// AI layer — proposals ONLY
// ---------------------------------------------------------------------------

export interface ParseContext {
  userId: string;
  walletId: string;
  network: Network;
}

/** LLM-backed. Returns a SUGGESTION; never trusted until validated. */
export interface IntentParser {
  parse(rawText: string, ctx: ParseContext): Promise<ParsedIntentProposal>;
}

// ---------------------------------------------------------------------------
// QR payment initiation (deterministic, local)
// ---------------------------------------------------------------------------

/**
 * Deterministic local EMVCo decoder (implemented by `@mova/qr`). No network,
 * no LLM. The decoded amount/account are trusted structured inputs.
 */
export interface QrDecoder {
  decode(payload: string): QrDecoded;
}

// ---------------------------------------------------------------------------
// Deterministic validation
// ---------------------------------------------------------------------------

/** Pure + deterministic. Re-computes money, checks enums, sets validationStatus. */
export interface IntentValidator {
  validate(proposal: ParsedIntentProposal, intent: PaymentIntent): ParsedIntent;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Deterministic discovery of candidate routes (uses MarketDataProvider). */
export interface RouteDiscovery {
  discover(intent: PaymentIntent, parsed: ParsedIntent): Promise<RouteCandidate[]>;
}

/**
 * Deterministic, pure ranking of candidates → `RouteOptimizationResult`
 * (ranked routes, selection score + reason, comparison rows and savings).
 * `options.weights` lets a user supply explicit preference weights that
 * override the criterion's default profile — never an AI-generated score.
 */
export interface RouteOptimizer {
  optimize(
    candidates: RouteCandidate[],
    criterion: SelectionCriterion,
    options?: {
      weights?: RoutePreferenceWeights;
      paymentIntentId?: string;
      now?: number;
    },
  ): RouteOptimizationResult;
}

// ---------------------------------------------------------------------------
// Compliance & risk (deterministic; fail-closed on error)
// ---------------------------------------------------------------------------

export interface ComplianceEngine {
  assess(intent: PaymentIntent, route: Route): Promise<ComplianceAssessment>;
}

export interface PortfolioSnapshot {
  walletId: string;
  balances: Money[];
  totalUsd: string;
  /** asset -> share (0..1) */
  concentration: Record<string, number>;
  timestamp: number;
}

/**
 * Phase 6 — deterministic financial risk assessment. Implemented by the
 * `RiskEngine` class in `src/risk/` (a portfolio snapshot is optional and not
 * required for the Phase 6 model).
 */
export interface FinancialRiskEngine {
  assess(
    intent: PaymentIntent,
    route: Route,
    portfolio?: PortfolioSnapshot,
  ): Promise<RiskAssessment>;
}

/** Phase 6 — deterministic hedge evaluation. Implemented by `src/risk/`. */
export interface HedgeEvaluator {
  evaluate(
    intent: PaymentIntent,
    route: Route,
    risk: RiskAssessment,
  ): Promise<{
    assessment: RiskAssessment;
    plan: HedgingPlan;
    comparison: RouteHedgeComparison;
  }>;
}

/**
 * Phase 6 — final payment recommendation facade (route + risk + hedge).
 * Implemented by the `HedgedRouteEngine` class in `src/risk/`.
 */
export interface PaymentAdvisor {
  compute(
    intent: PaymentIntent,
    parsed: ParsedIntent,
    criterion: SelectionCriterion,
  ): Promise<PaymentRecommendation>;
}

// ---------------------------------------------------------------------------
// Approval (human gate)
// ---------------------------------------------------------------------------

export interface CreateApprovalParams {
  paymentIntentId: string;
  requiredApproverIds: string[];
  level: ApprovalLevel;
  reason: string;
  ttlMs: number;
}

export interface ApprovalService {
  createRequest(params: CreateApprovalParams): Promise<ApprovalRequest>;
  recordDecision(
    requestId: string,
    approverId: string,
    decision: ApprovalDecision,
    note: string | null,
  ): Promise<ApprovalRequest>;
  getStatus(requestId: string): Promise<ApprovalRequest>;
}

// ---------------------------------------------------------------------------
// Execution & settlement (only path that moves value)
// ---------------------------------------------------------------------------

export interface ExecutionService {
  /** Builds explicit, validated execution params from approved plan. */
  buildPlan(
    intent: PaymentIntent,
    parsed: ParsedIntent,
    route: Route,
    approval: ApprovalRequest,
  ): Promise<SettlementTransaction>;
  /** eth_call-style simulation BEFORE submission. */
  simulate(plan: SettlementTransaction): Promise<SimulationResult>;
  /** Submits via SettlementProvider; records audit. */
  execute(plan: SettlementTransaction): Promise<SettlementTransaction>;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditService {
  /** Append-only. Corrections are new events, never edits. */
  /** QR channel: decode locally (deterministic), then normal intent pipeline. */
  createFromQr(payload: string, ctx: ParseContext): Promise<PaymentIntent>;
  record(event: Omit<AuditEvent, "id" | "timestamp">): Promise<AuditEvent>;
  listByCorrelation(correlationId: string): Promise<AuditEvent[]>;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Top-level payment pipeline: parse -> validate -> route -> compliance ->
 *  risk -> approval -> execute. Implementation arrives in Phase 1. */
export interface PaymentOrchestrator {
  createFromText(rawText: string, ctx: ParseContext): Promise<PaymentIntent>;
  approve(paymentIntentId: string, approverId: string, decision: ApprovalDecision): Promise<PaymentIntent>;
  execute(paymentIntentId: string, triggeredBy: string): Promise<PaymentIntent>;
  getStatus(paymentIntentId: string): Promise<PaymentIntent>;
}

// ---------------------------------------------------------------------------
// Re-exports of provider contracts for convenience
// ---------------------------------------------------------------------------

export type {
  HedgingProvider,
  MarketDataProvider,
  ScreeningProvider,
  SettlementProvider,
};

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export interface WalletService {
  listByUser(userId: string): Promise<Wallet[]>;
  getOperatingWallet(userId: string): Promise<Wallet>;
}
