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
  RouteStatus,
  ScreeningDecision,
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

export interface RouteLeg {
  from: string;
  to: string;
  asset: string;
  amount: Money;
  provider: string;
  fee: Money;
  estimatedTimeMs: number;
}

export interface Route {
  id: string;
  paymentIntentId: string;
  /** Candidate number within this intent (1..N). */
  routeNo: number;
  legs: RouteLeg[];
  totalFee: Money;
  /** Total estimated cost to the user (fees + slippage), smallest units. */
  totalEstimatedCost: Money;
  estimatedTimeMs: number;
  /** Deterministic 0..1 reliability score. */
  reliability: number;
  status: RouteStatus;
  selectionScore: number; // computed by the optimizer
  selectionReason: string;
  createdAt: Timestamp;
}

/** Deterministic routing candidate BEFORE optimization ranking. */
export interface RouteCandidate {
  routeNo: number;
  legs: RouteLeg[];
  totalFee: Money;
  totalEstimatedCost: Money;
  estimatedTimeMs: number;
  /** Deterministic 0..1 reliability score. */
  reliability: number;
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
}

export interface HedgingPlan {
  recommended: boolean;
  strategy: HedgingStrategy;
  provider: string; // e.g. "THETANUTS"
  params: Record<string, string>;
  estimatedCost: Money;
  expiresAt: Timestamp;
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
