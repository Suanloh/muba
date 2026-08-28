/**
 * MOVA Phase 7 — deterministic execution types.
 *
 * These are the shapes that turn a validated, approved payment into a real
 * settlement WITHOUT letting raw LLM output or mutable UI state influence the
 * transaction:
 *
 *   - `TransactionSpec`  — the deterministic, signed-against plan. Built ONLY
 *     from validated state (recipient, amount in smallest units, network,
 *     selected route). The human approves its `planDigest`; execution is built
 *     from this exact spec and the digest is verified before anything moves.
 *   - `PaymentPreview`   — the human-facing summary of the spec (everything the
 *     user must understand before approving).
 *   - `ExecutionFailureInfo` — a structured, user-actionable failure taxonomy
 *     (user rejection, insufficient balance, network failure, invalid
 *     recipient, transaction failure, timeout, integration unavailable, and
 *     idempotency violations).
 *   - `PaymentExecutionInfo` — per-record execution/idempotency state so a
 *     payment can never be executed twice.
 *
 * Principle: AI recommends → deterministic engines validate → human approves
 * the digest → wallet authorizes → execution settles. Nothing here is produced
 * by an LLM.
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
  TransactionStatus,
} from "./enums.js";
import type { RiskAssessment, RouteSavings, RouteSummary } from "./domain.js";

// ---------------------------------------------------------------------------
// Transaction spec — the deterministic, signed-against execution plan
// ---------------------------------------------------------------------------

/** What kind of Sui transaction the spec describes. */
export type TransactionSpecKind = "NATIVE_TRANSFER" | "TOKEN_TRANSFER";

/**
 * The deterministic transaction specification for ONE payment. Built only from
 * validated state (never from raw LLM output). `planDigest` is a stable hash
 * of the canonical field set — the human approves this digest, and execution
 * verifies it before building/submitting any transaction.
 */
export interface TransactionSpec {
  version: "1";
  kind: TransactionSpecKind;
  /** Idempotency key — one key per logical payment; execution refuses reuse. */
  clientRequestId: string;
  recordId: string;
  correlationId: string;
  /** Validated owner address (the sender / gas payer). */
  sender: string;
  /** Validated Sui destination address (canonical lowercase 0x…). */
  recipient: string;
  /** Amount to move, in smallest units. */
  amount: Money;
  network: Network;
  /** Selected route id from the deterministic routing engine. */
  routeId: string;
  /** Total route fees (quote asset, smallest units). */
  fees: Money;
  /** Final total cost (route + hedge premium when hedged, quote asset). */
  totalCost: Money;
  /** Stable hash over the canonical field set (SHA-256 hex). */
  planDigest: string;
  createdAt: number;
  /** Execution window — approvals expire after this. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Payment preview — what the human must understand before approving
// ---------------------------------------------------------------------------

/** Which stage of the execution pipe a failure occurred in. */
export type ExecutionStage =
  | "INTENT_PARSE"
  | "INTENT_VALIDATION"
  | "ROUTE_DISCOVERY"
  | "ROUTE_OPTIMIZATION"
  | "COMPLIANCE"
  | "RISK_HEDGE"
  | "EXPLANATION"
  | "HUMAN_APPROVAL"
  | "WALLET_AUTHZ"
  | "EXECUTION"
  | "SUI_SETTLEMENT";

/**
 * Structured failure taxonomy. Every failure path in the execution pipe is
 * classified into one of these so the UI can tell the user exactly what
 * happened and whether it is safe to retry.
 */
export type ExecutionFailureCode =
  | "USER_REJECTED" // the human (or wallet) declined the payment/signature
  | "INSUFFICIENT_BALANCE" // pre-flight balance check failed
  | "NETWORK_FAILURE" // wallet network / RPC unreachable or mismatch
  | "INVALID_RECIPIENT" // destination failed validation
  | "TRANSACTION_FAILED" // on-chain submission/settlement failed
  | "TIMEOUT" // settlement did not confirm within the window
  | "INTEGRATION_UNAVAILABLE" // an external engine/provider was unavailable
  | "IDEMPOTENCY_VIOLATION" // duplicate/expired/replayed execution attempt
  | "APPROVAL_EXPIRED"
  | "UNKNOWN";

export interface ExecutionFailureInfo {
  code: ExecutionFailureCode;
  stage: ExecutionStage;
  message: string;
  /** True when the failure is deterministic and caused by user action. */
  userActionable: boolean;
  /** True when retrying the SAME logical payment is safe (no partial execution). */
  retryable: boolean;
  /** MovaError code string when classified from one. */
  errorCode?: string;
  /** Real on-chain digest when a transaction failed after submission. */
  txDigest?: string | null;
  at: number;
}

/** Condensed route view for the preview (from the selected Route). */
export interface PaymentPreviewRoute {
  id: string;
  routeNo: number;
  summary: RouteSummary;
  /** Total fees (quote asset). */
  totalFee: Money;
  /** Total estimated cost (fees + slippage, quote asset). */
  totalEstimatedCost: Money;
  estimatedTimeMs: number;
  reliability: number;
  selectionReason: string;
}

/** Compliance verdict shown in the preview (deterministic, fail-closed). */
export interface PaymentPreviewCompliance {
  decision: ComplianceDecision;
  riskScore: number;
  failClosed: boolean;
  matchedLists: string[];
  explanation: string;
}

/** Hedge decision shown in the preview (route vs route+hedge). */
export interface PaymentPreviewHedge {
  strategy: HedgingStrategy;
  decision: HedgeDecision;
  dataSource: HedgeDataSource;
  /** Extra cost of hedging (quote asset). */
  premium: Money;
  /** Exposure removed by the hedge (quote asset). */
  exposureReduction: Money;
  explanation: string;
}

/**
 * The complete, human-readable summary the user reviews and approves. Every
 * field feeds from a deterministic engine — nothing comes from the LLM.
 */
export interface PaymentPreview {
  recordId: string;
  correlationId: string;
  clientRequestId: string;
  action: IntentAction;
  recipient: { type: RecipientType; value: string; name: string | null };
  /** The exact amount that will be moved (smallest units). */
  amount: Money;
  /** Canonical Sui destination (lowercase 0x…). */
  suiDestination: string;
  route: PaymentPreviewRoute;
  savings: RouteSavings | null;
  compliance: PaymentPreviewCompliance;
  risk: RiskAssessment;
  hedge: PaymentPreviewHedge;
  /** Final total cost (route + hedge premium when hedged). */
  totalCost: Money;
  expectedSettlement: "REAL" | "SIMULATED";
  /** The digest of the spec the user is approving. */
  planDigest: string;
  createdAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Per-record execution & idempotency state
// ---------------------------------------------------------------------------

/**
 * Per-record execution/idempotency state. Stored on the PaymentRecord so a
 * payment can be executed at most once: an executed or in-flight spec digest
 * refuses re-execution, and a changed digest for the same `clientRequestId`
 * refuses replay.
 */
export interface PaymentExecutionInfo {
  clientRequestId: string;
  specDigest: string;
  /** Number of execution attempts so far. */
  attempts: number;
  lastAttemptAt: number | null;
  /** Set once execution settled (success or terminal failure). */
  executedAt: number | null;
  /** Structured failure of the last attempt (null when none/last succeeded). */
  failure: ExecutionFailureInfo | null;
  settlement: TransactionStatus | null;
}
