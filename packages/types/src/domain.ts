/**
 * MOVA domain entities.
 *
 * Single source of truth for the data model. The relational schema
 * (`packages/db`, Phase 1) mirrors these types. Money is always `Money`
 * (smallest-unit decimal string) — never floats.
 *
 * Trust rule: fields suffixed `Proposal` or produced by the AI layer are
 * SUGGESTIONS. Deterministic validators re-compute every money figure and
 * decision before it is stored as authoritative.
 */
import type {
  ActorType,
  ApprovalDecision,
  ApprovalLevel,
  ApprovalStatus,
  ComplianceDecision,
  HedgeDataSource,
  HedgeDecision,
  HedgingStrategy,
  IntentAction,
  IntentSource,
  Money,
  Network,
  ParsedIntentStatus,
  ProviderKind,
  RecipientType,
  RiskBand,
  RiskDecision,
  RouteLegKind,
  RouteStatus,
  ScreeningDecision,
  SelectionCriterion,
  SettlementMode,
  TransactionStatus,
  TransactionType,
  UserRole,
  UserStatus,
  WalletStatus,
  WalletType,
} from "./enums.js";

/** Millisecond epoch timestamp. */
export type Timestamp = number;

/** Stable identifier shared by every record of one payment flow. */
export type CorrelationId = string;

// ---------------------------------------------------------------------------
// Actors & wallets
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  externalId: string; // auth-provider subject id
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  kycStatus: "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Wallet {
  id: string;
  userId: string;
  type: WalletType;
  network: Network;
  address: string; // Sui address (starts with 0x)
  label: string;
  status: WalletStatus;
  /** Deterministic snapshot of the wallet ledger, not a live RPC read. */
  availableBalance: Money | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Payment intent (the user's request) & parsed intent (AI proposal)
// ---------------------------------------------------------------------------

export interface PaymentIntent {
  id: string;
  correlationId: CorrelationId;
  /** Human reference, e.g. "PAY-2026-0001". */
  intentRef: string;
  userId: string;
  walletId: string;
  source: IntentSource;
  /** Original natural-language request. Kept verbatim for auditability. */
  rawText: string;
  network: Network;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** AI output — a SUGGESTION only. Never trusted until validated. */
export interface ParsedIntent {
  id: string;
  paymentIntentId: string;
  action: IntentAction;
  amount: Money;
  recipient: {
    type: RecipientType;
    value: string; // address / handle / email
    name: string | null;
  };
  network: Network;
  /** ISO-8601 or null for immediate. */
  scheduleAt: string | null;
  memo: string | null;
  confidence: number; // 0..1
  needsClarification: boolean;
  clarificationQuestion: string | null;
  /** Raw LLM output retained for audit. */
  rawLlmOutput: unknown;
  /** Set by the deterministic validator. */
  validationStatus: ParsedIntentStatus;
  /** Deterministic validator notes (reasons for INVALID / NEEDS_CLARIFICATION). */
  validatorNotes: string[];
  /** Re-computed, canonical money (validator output, not LLM value). */
  canonicalAmount: Money;
  createdAt: Timestamp;
}

/**
 * AI output BEFORE validation — a SUGGESTION only. The deterministic
 * `IntentValidator` re-computes every money figure and sets
 * `validationStatus` / `canonicalAmount` on the authoritative `ParsedIntent`.
 */
export interface ParsedIntentProposal {
  action: IntentAction;
  amount: Money;
  recipient: {
    type: RecipientType;
    value: string;
    name: string | null;
  };
  network: Network;
  scheduleAt: string | null;
  memo: string | null;
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  /** Raw LLM output retained for audit. */
  rawLlmOutput: unknown;
}

// ---------------------------------------------------------------------------
// QR payment initiation (deterministic, LOCAL EMVCo decode — no external call)
// ---------------------------------------------------------------------------

/**
 * Result of locally decoding an EMVCo Merchant-Presented QR payload.
 * Produced by `@mova/qr` (`EmvcoQrDecoder`) — fully deterministic, no LLM,
 * no network. The decoded amount/account are trusted inputs into the intent
 * pipeline (the AI may assist interpretation, never overwrite these).
 */
export interface QrDecoded {
  source: "EMVCO";
  /** EMVCo field 00 (payload format indicator), e.g. "01". */
  payloadFormat: string | null;
  /** EMVCo field 59. */
  merchantName: string | null;
  /** EMVCo field 60. */
  merchantCity: string | null;
  /** EMVCo fields 02–05 or 26–51 (merchant account information). */
  merchantAccount: string | null;
  /** EMVCo field 52 (merchant category code). */
  categoryCode: string | null;
  /** EMVCo field 53 — ISO 4217 numeric currency, e.g. "458" (MYR). */
  currencyCode: string | null;
  /** EMVCo field 54 — decimal amount exactly as scanned, e.g. "10.00". */
  amountRaw: string | null;
  /** Smallest units (2-decimal assumption for QR fiat amounts); asset = currencyCode. */
  amount: Money | null;
  /** EMVCo field 58 — ISO 3166-1 alpha-2 country code. */
  countryCode: string | null;
  /** EMVCo field 62 sub-field 03 (reference). */
  reference: string | null;
  /** EMVCo field 62 sub-field 01 (bill number). */
  billNumber: string | null;
  /** CRC-16/CCITT over the payload excluding the CRC field. */
  crcValid: boolean;
  /** The raw scanned payload (hex string) — retained for audit. */
  raw: string;
  /** Non-fatal + fatal decode issues (e.g. CRC mismatch, malformed TLV). */
  parseErrors: string[];
}

// ---------------------------------------------------------------------------
// Routing (deterministic discovery + optimization)
// ---------------------------------------------------------------------------

/**
 * A single step in a payment route. Every route ends with an ONCHAIN leg on
 * Sui and a SETTLEMENT leg to the recipient, so MOVA always settles on Sui.
 * All numeric fields are deterministic; nothing here is produced by an LLM.
 */
export interface RouteLeg {
  kind: RouteLegKind;
  /** Source asset symbol (or fiat ISO code, e.g. "USD", "MYR"). */
  from: string;
  /** Destination asset symbol. */
  to: string;
  /** Asset moved on this leg. */
  asset: string;
  /** Amount moved on this leg (smallest units). */
  amount: Money;
  /** Rail/provider identifier, e.g. "SUI_CHAIN", "MOVA_DEX", "MOVA_ONRAMP". */
  provider: string;
  /** Fee charged by this leg, in the leg's fee asset (e.g. gas in SUI). */
  fee: Money;
  estimatedTimeMs: number;
  /** Deterministic 0..1 reliability of this leg. */
  reliability: number;
  /** Deterministic 0..1 liquidity of this leg. */
  liquidity: number;
  /** Deterministic 0..1 risk factor of this leg (higher = riskier). */
  riskFactor: number;
  /** Transparent note for the cost breakdown (e.g. "1.5% on-ramp fee"). */
  note: string;
}

/**
 * Transparent per-route cost breakdown. Every figure is a `Money` in
 * `quoteAsset` (the common numeraire, default USDC) smallest units so routes
 * are directly comparable. `total` is the source of `totalEstimatedCost`.
 */
export interface RouteCostBreakdown {
  quoteAsset: string;
  /** Sum of all leg fees (payment fees), incl. swap fee + spread on conversions. */
  paymentFees: Money;
  /** Conversion/swap costs (swap fee + spread) on CONVERSION legs. */
  conversionCost: Money;
  /** Estimated slippage on CONVERSION legs. */
  slippage: Money;
  /** Other route costs (service fees, etc.) — reserved, currently 0. */
  other: Money;
  /** paymentFees + conversionCost + slippage + other. */
  total: Money;
}

/** One labelled, deterministic risk driver on a route. */
export interface RouteRiskFactor {
  factorId: string;
  label: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  /** Deterministic 0..1 weight of this factor in the composite score. */
  weight: number;
  /** Deterministic 0..1 level of this factor. */
  level: number;
  note: string;
}

/** Composite route risk — lower is safer. */
export interface RouteRisk {
  /** Deterministic 0..1 score (weighted mean of the factors' levels). */
  score: number;
  factors: RouteRiskFactor[];
}

/** Transparent summary of a route's composition (for the comparison view). */
export interface RouteSummary {
  sourceAsset: string;
  destinationAsset: string;
  hasConversion: boolean;
  conversionCount: number;
  hasOffchainLeg: boolean;
  hasOnchainLeg: boolean;
  settleOnSui: boolean;
  /** Ordered leg kinds, e.g. ["CONVERSION","ONCHAIN","SETTLEMENT"]. */
  legOrder: RouteLegKind[];
}

/** Deterministic routing candidate BEFORE optimization ranking. */
export interface RouteCandidate {
  /** Candidate number within this intent (1..N). */
  routeNo: number;
  legs: RouteLeg[];
  summary: RouteSummary;
  cost: RouteCostBreakdown;
  /** Sum of all leg fees in quoteAsset (== cost.paymentFees). */
  totalFee: Money;
  /** Total estimated cost to the user (== cost.total = fees + slippage). */
  totalEstimatedCost: Money;
  estimatedTimeMs: number;
  /** Deterministic 0..1 reliability score (product of leg reliabilities). */
  reliability: number;
  /** Deterministic 0..1 liquidity score (minimum of leg liquidity). */
  liquidity: number;
  risk: RouteRisk;
}

/**
 * Per-factor selection scores (1 = best on that factor) used in the
 * comparison view. Computed by the optimizer via min-max normalization
 * across the candidate set — no floats, no LLM, fully reproducible.
 */
export interface RouteFactorScores {
  cost: number; // 1 = cheapest
  speed: number; // 1 = fastest
  risk: number; // 1 = safest
  reliability: number; // 1 = most reliable
  liquidity: number; // 1 = most liquid
}

/**
 * Explicit user preference weights (all >= 0; the optimizer normalizes them
 * to sum to 1). This is how a user steers the score — never an unexplained
 * AI-generated number.
 */
export interface RoutePreferenceWeights {
  cost: number;
  speed: number;
  reliability: number;
  risk: number;
  liquidity: number;
}

/** A ranked route produced by the optimizer. */
export interface Route extends RouteCandidate {
  id: string;
  paymentIntentId: string;
  status: RouteStatus;
  /** Deterministic composite 0..1 score (higher = better). */
  selectionScore: number;
  /** Transparent math: the weights, per-factor scores and why this won. */
  selectionReason: string;
  factorScores: RouteFactorScores;
  createdAt: Timestamp;
}

/** One row of the route comparison table (Route B vs Route A, etc.). */
export interface RouteComparisonRow {
  routeNo: number;
  totalCost: Money;
  estimatedTimeMs: number;
  riskScore: number; // 0..1 (lower = safer)
  reliability: number; // 0..1
  liquidity: number; // 0..1
  selectionScore: number; // 0..1
}

/**
 * Savings analysis over the candidate set: the cheapest route, the selected
 * route, and the cost difference between them plus a reference to the most
 * expensive viable route.
 */
export interface RouteSavings {
  cheapestRouteNo: number;
  cheapestTotalCost: Money;
  selectedRouteNo: number | null;
  selectedTotalCost: Money | null;
  mostExpensiveRouteNo: number;
  mostExpensiveTotalCost: Money;
  /** selectedTotalCost − cheapestTotalCost (>= 0; 0 when selected == cheapest). */
  premiumVsCheapest: Money;
  /** mostExpensiveTotalCost − selectedTotalCost (the money saved vs the worst route). */
  estimatedSavings: Money;
  selectedIsCheapest: boolean;
  /** Transparent, human-readable savings math. */
  explanation: string;
}

/** Full output of the optimizer: ranked routes + comparison + savings. */
export interface RouteOptimizationResult {
  routes: Route[];
  selected: Route | null;
  criterion: SelectionCriterion;
  /** Effective weights actually used (normalized to 1). */
  weights: RoutePreferenceWeights;
  comparison: RouteComparisonRow[];
  savings: RouteSavings | null;
  engineVersion: string;
}

// ---------------------------------------------------------------------------
// Compliance (deterministic engine output)
// ---------------------------------------------------------------------------

export interface ScreeningResult {
  counterpartyId: string;
  nameMatched: boolean;
  identifierMatched: boolean;
  matchedLists: string[];
  /** Deterministic 0..100 score. */
  score: number;
  decision: ScreeningDecision;
  /** Versioned source list used. */
  listVersion: string;
}

export interface MonitoringSignal {
  ruleId: string;
  description: string;
  value: string;
  threshold: string;
  triggered: boolean;
}

export interface PolicyResult {
  policyId: string;
  rule: string;
  threshold: string;
  value: string;
  decision: ComplianceDecision;
}

export interface TravelRuleResult {
  required: boolean;
  complete: boolean;
  missingFields: string[];
}

export interface ComplianceAssessment {
  id: string;
  paymentIntentId: string;
  routeId: string;
  screening: ScreeningResult;
  monitoringSignals: MonitoringSignal[];
  /** Unified 0..100 compliance risk score. */
  riskScore: number;
  policyResults: PolicyResult[];
  travelRule: TravelRuleResult;
  /** Deterministic aggregate: BLOCK > REVIEW > ALLOW. */
  decision: ComplianceDecision;
  /** Fail-closed marker — any engine error must result in REVIEW/BLOCK. */
  failClosed: boolean;
  engineVersion: string;
  /** Deterministic explanation; LLM may polish prose only. */
  explanation: string;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Risk & hedging (deterministic financial risk + hedging plan)
// ---------------------------------------------------------------------------

export interface RiskSignal {
  signalId: string;
  description: string;
  value: string;
  threshold: string;
  weight: number;
  contribution: number; // 0..100
  /** Deterministic explanation of how the contribution was computed. */
  note?: string;
}

export interface HedgingPlan {
  recommended: boolean;
  strategy: HedgingStrategy;
  provider: string; // e.g. "THETANUTS"
  params: Record<string, string>;
  estimatedCost: Money;
  expiresAt: Timestamp;
  /** Honest provenance: LIVE / STATIC_DEV / UNAVAILABLE. */
  dataSource?: HedgeDataSource;
  /** Deterministic note (e.g. why hedging is/isn't recommended, gap). */
  note?: string;
}

export interface RiskAssessment {
  id: string;
  paymentIntentId: string;
  routeId: string;
  /** Financial risk band (distinct from compliance riskScore). */
  band: RiskBand;
  score: number; // 0..100
  signals: RiskSignal[];
  hedging: HedgingPlan;
  decision: RiskDecision;
  engineVersion: string;
  explanation: string;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Risk inputs — deterministic volatility model (Phase 6)
// ---------------------------------------------------------------------------

/** Deterministic volatility snapshot for one asset (annualized + daily). */
export interface VolatilitySnapshot {
  asset: string;
  /** Annualized volatility as a decimal (0.20 = 20%). */
  annualizedVol: number;
  /** Daily volatility as a decimal (annualized / sqrt(365)). */
  dailyVol: number;
  /** Horizon over which exposure is assessed, in days. */
  horizonDays: number;
  /** Confidence level for Value-at-Risk (0..1, e.g. 0.95). */
  confidenceLevel: number;
  /**
   * Provenance of the volatility data, e.g. "THETANUTS_OPTIONBOOK" for live
   * implied vol or "STATIC_DEV_TABLE" for the cached dev table.
   */
  source: string;
  /** True when this snapshot is simulated/dev data — never treated as live. */
  simulated: boolean;
  asOf: Timestamp;
}

// ---------------------------------------------------------------------------
// Hedge evaluation (Phase 6) — deterministic route-with-vs-without hedge math
// ---------------------------------------------------------------------------

/** Effect of a hedge on a payment: exposure, cost, and route-cost impact. */
export interface HedgeImpact {
  /** The asset whose price move is hedged (e.g. "SUI", "ETH"). */
  hedgedAsset: string;
  /** Gross exposure in quoteAsset (smallest units) before hedging. */
  grossExposure: Money;
  /** Exposure after the hedge (gross − reduction), in quoteAsset. */
  netExposure: Money;
  /** Exposure removed by the hedge (gross − net), in quoteAsset. */
  exposureReduction: Money;
  /** Relative reduction 0..1 (reduction / gross). */
  exposureReductionRatio: number;
  /** Unhedged Value-at-Risk the hedge offsets, in quoteAsset. */
  valueAtRisk: Money;
  /** Hedge premium converted to quoteAsset. */
  hedgeCost: Money;
  /** Hedge premium as basis points of the unhedged route cost. */
  hedgeCostBps: number;
  /** Route total cost WITHOUT the hedge (== route.totalEstimatedCost). */
  routeCostWithoutHedge: Money;
  /** Route total cost WITH the hedge (route cost + premium). */
  routeCostWithHedge: Money;
  /** Honest provenance: LIVE | STATIC_DEV | UNAVAILABLE. */
  dataSource: HedgeDataSource;
}

/**
 * One route compared with and without a hedge — the "route vs route+hedge"
 * comparison the routing engine exposes, with a deterministic final call.
 */
export interface RouteHedgeComparison {
  routeNo: number;
  /** Strategy chosen for this route (NONE when no hedge). */
  strategy: HedgingStrategy;
  /** Final deterministic call: HEDGE or NO_HEDGE. */
  hedgeDecision: HedgeDecision;
  /** True when a hedge is needed AND cost-effective (== decision HEDGE). */
  recommended: boolean;
  /** Route cost without the hedge (== route.totalEstimatedCost). */
  withoutHedge: Money;
  /** Route cost with the hedge (withoutHedge + premium). */
  withHedge: Money;
  /** Extra cost of hedging (withHedge − withoutHedge), >= 0. */
  delta: Money;
  /** delta as basis points of withoutHedge. */
  deltaBps: number;
  /** Exposure removed by hedging, in quoteAsset. */
  exposureReduction: Money;
  /** Relative exposure reduction 0..1. */
  exposureReductionRatio: number;
  /** Honest provenance: LIVE | STATIC_DEV | UNAVAILABLE. */
  dataSource: HedgeDataSource;
  /** Deterministic, human-readable rationale (the math). */
  reason: string;
}

/**
 * MOVA's final payment recommendation — the Phase 6 deliverable. Combines the
 * routed route, the financial risk assessment, and the route-with-vs-without
 * hedge decision into one deterministic, explainable recommendation.
 */
export interface PaymentRecommendation {
  id: string;
  paymentIntentId: string;
  route: Route;
  risk: RiskAssessment;
  hedge: RouteHedgeComparison;
  /** Final total cost: route cost + hedge premium when hedged, else route cost. */
  totalCost: Money;
  /** True when the final recommendation includes a hedge. */
  hedged: boolean;
  /** Financial risk decision: PROCEED / REVIEW / BLOCK. */
  decision: RiskDecision;
  /** Deterministic, human-readable summary of the whole recommendation. */
  explanation: string;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export interface Approval {
  approverId: string;
  decision: ApprovalDecision;
  note: string | null;
  signedAt: Timestamp;
  /** How the approver confirmed (e.g. "UI", "SIGNATURE"). */
  method: string;
}

export interface ApprovalRequest {
  id: string;
  paymentIntentId: string;
  level: ApprovalLevel;
  requiredApproverIds: string[];
  approvals: Approval[];
  status: ApprovalStatus;
  /** Deterministic threshold met check (role-weighted for THRESHOLD). */
  thresholdMet: boolean;
  reason: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  resolvedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Execution & settlement
// ---------------------------------------------------------------------------

export interface SimulationResult {
  ok: boolean;
  /** Decoded revert reason when !ok. */
  revertReason: string | null;
  estimatedGas: string | null;
}

export interface SettlementTransaction {
  id: string;
  paymentIntentId: string;
  approvalId: string;
  type: TransactionType;
  network: Network;
  /** Explicit, validated execution params — NEVER produced by the LLM. */
  payload: unknown;
  simulation: SimulationResult;
  status: TransactionStatus;
  /** Real Sui digest. NULL in simulation mode (never fabricate one). */
  txDigest: string | null;
  /** True when settled through SimulatedSettlementProvider (audit marker). */
  simulated: boolean;
  error: string | null;
  createdAt: Timestamp;
  confirmedAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditActor {
  type: ActorType;
  /** user id / service id / "llm:<model>" */
  id: string;
}

export interface AuditEvent {
  id: string;
  correlationId: CorrelationId;
  entityType: "PAYMENT_INTENT" | "ROUTE" | "COMPLIANCE" | "RISK" | "APPROVAL" | "TRANSACTION";
  entityId: string;
  eventType: string;
  actor: AuditActor;
  /** Full decision context: inputs, matched rules, outcome. Immutable. */
  payload: unknown;
  previousState: string | null;
  newState: string | null;
  /** Marked true for any simulated (mock-provider) activity. */
  simulated: boolean;
  timestamp: Timestamp;
}

// ---------------------------------------------------------------------------
// Support types
// ---------------------------------------------------------------------------

export interface ProviderDescriptor {
  kind: ProviderKind;
  /** e.g. "SIMULATED_SUI", "THETANUTS", "MOCK_MARKET_DATA". */
  name: string;
  network: Network | null;
}

export interface RuntimeConfig {
  env: "dev" | "testnet" | "mainnet";
  settlementMode: SettlementMode;
  useMocks: boolean;
  network: Network;
}
