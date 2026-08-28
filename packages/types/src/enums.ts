/**
 * Shared enumerations / union types for MOVA.
 *
 * These are closed sets. Prefer these unions over free strings anywhere a value
 * crosses a module boundary (see `ai-deterministic-boundary` and
 * `structured-llm-output` skills).
 */

// ---------------------------------------------------------------------------
// Money & identity
// ---------------------------------------------------------------------------

/** A monetary amount expressed in the smallest unit of `asset` (e.g. base units,
 *  not float dollars). Stored as a decimal string to avoid float drift. */
export interface Money {
  /** Asset symbol or coin type, e.g. "SUI", "USDC". */
  asset: string;
  /** Amount in smallest units (integer as decimal string). */
  amount: string;
}

export type Network = "SUI_DEVNET" | "SUI_TESTNET" | "SUI_MAINNET";

/** Origin of a piece of data. AI = proposal/suggestion only, never authority. */
export type ActorType = "USER" | "SYSTEM" | "AI" | "APPROVER" | "EXTERNAL";

// ---------------------------------------------------------------------------
// Actors & wallets
// ---------------------------------------------------------------------------

export type UserRole =
  | "OWNER"
  | "APPROVER"
  | "OPERATOR"
  | "AUDITOR"
  | "ADMIN";

export type UserStatus = "PENDING_KYC" | "ACTIVE" | "SUSPENDED" | "CLOSED";

export type WalletType = "OPERATING" | "CUSTODY" | "RESERVE" | "VAULT";

export type WalletStatus = "ACTIVE" | "FROZEN" | "CLOSED";

// ---------------------------------------------------------------------------
// Intents (user request + AI parse)
// ---------------------------------------------------------------------------

export type IntentSource = "CHAT" | "API" | "MANUAL" | "QR";

export type IntentAction = "PAY" | "TRANSFER" | "BATCH_PAY";

export type RecipientType = "ADDRESS" | "HANDLE" | "EMAIL";

export type ParsedIntentStatus =
  | "PENDING"
  | "VALIDATED"
  | "INVALID"
  | "NEEDS_CLARIFICATION";

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type RouteStatus = "CANDIDATE" | "SELECTED" | "REJECTED";

export type SelectionCriterion = "COST" | "SPEED" | "RELIABILITY";

/** What a single route leg does (used to label the route composition). */
export type RouteLegKind = "CONVERSION" | "OFFCHAIN" | "ONCHAIN" | "SETTLEMENT";

// ---------------------------------------------------------------------------
// Compliance (deterministic engine output)
// ---------------------------------------------------------------------------

export type ComplianceDecision = "ALLOW" | "REVIEW" | "BLOCK";

export type ScreeningDecision = "CLEAR" | "HIT" | "REVIEW";

// ---------------------------------------------------------------------------
// Risk & hedging (deterministic engine output)
// ---------------------------------------------------------------------------

export type RiskBand = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskDecision = "PROCEED" | "REVIEW" | "BLOCK";

export type HedgingStrategy =
  | "NONE"
  | "PUT_OPTION"
  | "COVERED_CALL"
  | "FIXED_YIELD";

/** Final deterministic hedging call for a route. */
export type HedgeDecision = "HEDGE" | "NO_HEDGE";

/**
 * Honest provenance of hedge/volatility data. MOVA never pretends mocked data
 * is live: `STATIC_DEV` data is simulated/dev-only, `UNAVAILABLE` means the
 * live sponsor could not be reached (integration gap recorded, never faked).
 */
export type HedgeDataSource = "LIVE" | "STATIC_DEV" | "UNAVAILABLE";

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export type ApprovalLevel = "SINGLE" | "DUAL" | "THRESHOLD";

export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export type ApprovalDecision = "APPROVE" | "REJECT" | "ABSTAIN";

// ---------------------------------------------------------------------------
// Execution & settlement
// ---------------------------------------------------------------------------

export type TransactionType = "NATIVE_TRANSFER" | "TOKEN_TRANSFER" | "PTB_BATCH";

export type TransactionStatus =
  | "PENDING"
  | "SIMULATED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "REVERTED"
  | "FAILED"
  | "CANCELLED";

export type SettlementMode = "simulated" | "real";

// ---------------------------------------------------------------------------
// Integration providers (sponsor boundary)
// ---------------------------------------------------------------------------

export type ProviderKind = "MOCK" | "REAL";
