/**
 * MOVA natural-language payment types (Phase 2).
 *
 * These types model the conversational path:
 *
 *   NL text → StructuredIntentProposal (AI, proposal only)
 *          → ValidatedStructuredIntent (deterministic validator)
 *          → User confirmation → payment pipeline
 *
 * Safety rule (see docs/nl-payments.md): the proposal is data only — it never
 * carries executable transaction instructions. It is validated by the
 * deterministic `IntentValidator` (`@mova/core`) and must be confirmed by a
 * human before it feeds the existing payment pipeline. The AI is a parser and
 * assistant — never a transaction executor, compliance authority, or final
 * payment authority.
 */
import type { IntentAction, Money, Network, RecipientType } from "./enums.js";

// ---------------------------------------------------------------------------
// Closed sets for the NL layer
// ---------------------------------------------------------------------------

/** Tokens MOVA can settle directly on Sui. */
export type SupportedToken = "SUI" | "USDC" | "MOV";

/**
 * Fiat currencies MOVA recognizes. They are NOT directly settleable on Sui —
 * they trigger a deterministic warning that a conversion is required.
 */
export type FiatCurrency =
  | "USD"
  | "MYR"
  | "EUR"
  | "SGD"
  | "GBP"
  | "AUD"
  | "JPY"
  | "IDR"
  | "THB"
  | "PHP"
  | "VND"
  | "HKD";

/** Any currency/token string the extractor can classify. */
export type Currency = SupportedToken | FiatCurrency | "UNKNOWN";

/** How the user wants to fund/settle the payment (if stated). */
export type PaymentMethod =
  | "WALLET_BALANCE"
  | "DIRECT"
  | "BATCH"
  | "UNKNOWN";

// ---------------------------------------------------------------------------
// Structured intent (AI proposal — never executable)
// ---------------------------------------------------------------------------

/** A recipient reference: address / handle / email, optionally resolved name. */
export interface RecipientRef {
  type: RecipientType;
  value: string;
  name: string | null;
  /** True when the recipient could not be resolved unambiguously. */
  ambiguous?: boolean;
  /** True when resolved from a known contact book entry. */
  resolved?: boolean;
}

/** A user-supplied constraint on the payment ("max fee 1 SUI", "by Friday"). */
export interface UserConstraint {
  kind: "FEE_CAP" | "SPEND_CAP" | "TIMING" | "SPEED" | "OTHER";
  label: string;
  raw: string;
}

/**
 * The AI's structured reading of one user message. This is a SUGGESTION.
 *
 * It deliberately does NOT carry a computed `Money` value — the parser only
 * reports what it saw (`amountRaw` + `currencyInput`). The deterministic
 * validator (`@mova/core`) is the ONLY place that converts those raw values
 * into canonical smallest-unit money (`canonicalAmount`). It never contains
 * transaction bytes or execution parameters.
 */
export interface StructuredIntentProposal {
  action: IntentAction;
  /** Decimal amount exactly as typed ("200", "100.50") — null if none seen. */
  amountRaw: string | null;
  /** What the user typed for the currency, e.g. "RM", "$", "USD", "SUI". */
  currencyInput: string;
  recipient: RecipientRef;
  /** Requested settlement network. MOVA is Sui-only. */
  network: Network;
  /** How the network was stated: none (defaulted), a supported one, or a rejected chain. */
  networkMentioned: "none" | "supported" | "unsupported";
  /** Deterministic conflict notes ("two different amounts", "amount changed"). */
  conflicts: string[];
  /** Payment purpose/memo ("for payroll"). */
  purpose: string | null;
  /** Resolved ISO-8601 schedule (null = immediate). */
  scheduleAt: string | null;
  /** Human timing phrase kept verbatim ("by Friday"). */
  timingLabel: string | null;
  constraints: UserConstraint[];
  paymentMethod: PaymentMethod | null;
  /** 0..1 parser confidence. */
  confidence: number;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  /** Non-fatal notes produced during extraction (e.g. fiat conversion). */
  warnings: string[];
  /** Verbatim user text — kept for auditability. */
  rawText: string;
  /** Raw LLM output retained for audit (null when not LLM-backed). */
  rawLlmOutput: unknown;
}

// ---------------------------------------------------------------------------
// Deterministic validation
// ---------------------------------------------------------------------------

export type ValidationIssueCode =
  | "MISSING_AMOUNT"
  | "INVALID_AMOUNT"
  | "MISSING_CURRENCY"
  | "UNSUPPORTED_CURRENCY"
  | "MISSING_RECIPIENT"
  | "INVALID_ADDRESS"
  | "AMBIGUOUS_RECIPIENT"
  | "UNSUPPORTED_NETWORK"
  | "CONFLICTING_INSTRUCTIONS"
  | "UNSUPPORTED_PAYMENT_METHOD"
  | "UNKNOWN";

export interface ValidationIssue {
  code: ValidationIssueCode;
  severity: "ERROR" | "WARNING";
  /** Which intent field the issue is about. */
  field: string;
  /** Human-readable, deterministic explanation. */
  message: string;
}

/** Deterministic validator output. Authority over the AI proposal. */
export interface ValidatedStructuredIntent {
  ok: boolean;
  /** Canonicalized proposal (amount recomputed), null when fatally invalid. */
  proposal: StructuredIntentProposal | null;
  /** Re-computed amount in smallest units (validator output, not LLM). */
  canonicalAmount: Money | null;
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  needsClarification: boolean;
  clarificationQuestion: string | null;
}

// ---------------------------------------------------------------------------
// Lightweight session context
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  id: string;
  role: "user" | "mova";
  text: string;
  at: number;
}

/**
 * Lightweight, session-only payment conversation. Holds the current turn
 * thread and the accumulated (working) validated intent. Deliberately NOT a
 * long-term memory system — state resets with the session.
 */
export interface PaymentConversation {
  sessionId: string;
  turns: ConversationTurn[];
  /** Latest deterministic validation of the accumulated draft. */
  workingIntent: ValidatedStructuredIntent | null;
  /** True once the user confirmed the working intent. */
  confirmed: boolean;
  /** Set once the confirmed intent was handed to the payment pipeline. */
  submittedRecordId: string | null;
}

// ---------------------------------------------------------------------------
// Parser context & explanation
// ---------------------------------------------------------------------------

export interface IntentParserContext {
  userId: string;
  walletId: string;
  /** Expected MOVA network (used when the user does not name one). */
  network: Network;
  /** Resolve a bare name / handle to a known recipient (contact book). */
  resolveRecipient?: (name: string) => RecipientRef | null;
  now?: number;
}

/** What MOVA says it understood — shown before the user confirms. */
export interface IntentExplanation {
  /** One-line sentence, e.g. "I understand: send 200 USDC to Alice on Sui Testnet." */
  summary: string;
  /** Field-by-field structured detail. */
  details: Array<{
    label: string;
    value: string;
    source: "parsed" | "inferred" | "missing";
  }>;
  /** Free-form notes (fiat conversion, ambiguity, clarifications). */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Turn outcome (what a single NL turn produced)
// ---------------------------------------------------------------------------

export interface NlTurnResult {
  /** Parsed proposal (may be partial). */
  proposal: StructuredIntentProposal | null;
  /** Deterministic validation of the (merged) draft. */
  validated: ValidatedStructuredIntent | null;
  /** Explanation of what MOVA understood. */
  explanation: IntentExplanation | null;
  /** True when the turn was a meta-intent (confirm/cancel), not a payment edit. */
  meta: "none" | "confirm" | "cancel";
  /** Human message MOVA replies with on this turn. */
  reply: string;
}
