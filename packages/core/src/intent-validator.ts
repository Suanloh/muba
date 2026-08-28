/**
 * Deterministic natural-language intent validator (Phase 2).
 *
 * This is the AUTHORITY over the AI proposal (`@mova/ai`). It is pure and
 * deterministic: no LLM, no network, no wallet. It re-computes every money
 * figure from the raw values the parser reported (`amountRaw` +
 * `currencyInput`) and classifies the proposal against the Phase 2 validation
 * matrix:
 *
 *   - missing amount
 *   - invalid amount
 *   - unsupported currency
 *   - missing recipient
 *   - invalid address
 *   - ambiguous recipient
 *   - unsupported network
 *   - conflicting instructions
 *   - unsupported payment method
 *
 * The AI is a parser/assistant only. It can never execute, approve, or bypass
 * this validator. A `ok: true` result still requires explicit human
 * confirmation before the payment pipeline may run.
 */
import {
  canonicalCurrency,
  isValidSuiAddress,
  normalizeDecimal,
  toSmallestUnits,
  TOKEN_DECIMALS,
  type IntentParserContext,
  type Money,
  type StructuredIntentProposal,
  type ValidationIssue,
  type ValidatedStructuredIntent,
} from "@mova/types";

// ---------------------------------------------------------------------------
// Issue helpers
// ---------------------------------------------------------------------------

function issue(
  code: ValidationIssue["code"],
  severity: ValidationIssue["severity"],
  field: string,
  message: string,
): ValidationIssue {
  return { code, severity, field, message };
}

function error(code: ValidationIssue["code"], field: string, message: string): ValidationIssue {
  return issue(code, "ERROR", field, message);
}

function warning(code: ValidationIssue["code"], field: string, message: string): ValidationIssue {
  return issue(code, "WARNING", field, message);
}

// ---------------------------------------------------------------------------
// Canonical amount (the ONLY place raw amounts become Money)
// ---------------------------------------------------------------------------

/**
 * Re-compute money from the raw parser values. Returns null when the amount
 * cannot be canonically expressed (invalid, or fiat needing conversion).
 */
export function computeCanonicalAmount(
  amountRaw: string | null,
  currencyInput: string,
): { money: Money; currency: "SUI" | "USDC" | "MOV" } | null {
  if (amountRaw === null || amountRaw.trim() === "") return null;
  const currency = canonicalCurrency(currencyInput);
  if (currency === "UNKNOWN") return null;
  if (!(currency in TOKEN_DECIMALS)) return null; // fiat — not directly settleable
  const token = currency as keyof typeof TOKEN_DECIMALS;
  const normalized = normalizeDecimal(amountRaw);
  if (normalized === null) return null;
  const decimals = TOKEN_DECIMALS[token];
  return { money: { asset: token, amount: toSmallestUnits(normalized, decimals) }, currency: token };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface ValidateProposalResult extends ValidatedStructuredIntent {
  /** The canonicalized proposal (same fields, canonical amount attached). */
  proposal: StructuredIntentProposal | null;
}

/**
 * Deterministically validate a parsed NL proposal. Re-computes money and sets
 * `ok`, `canonicalAmount`, `issues` (errors + warnings) and clarification
 * state. Pure — safe to call from any layer.
 */
export function validateStructuredProposal(
  proposal: StructuredIntentProposal,
  _ctx: IntentParserContext,
): ValidateProposalResult {
  const issues: ValidationIssue[] = [];

  // --- Amount --------------------------------------------------------------
  const hasAmount = proposal.amountRaw !== null && proposal.amountRaw.trim() !== "";
  if (!hasAmount) {
    issues.push(
      error(
        "MISSING_AMOUNT",
        "amount",
        "No amount found — tell me how much to send (e.g. \"200 USDC\").",
      ),
    );
  } else {
    const normalized = normalizeDecimal(proposal.amountRaw ?? "");
    if (normalized === null) {
      issues.push(
        error(
          "INVALID_AMOUNT",
          "amount",
          `"${proposal.amountRaw}" is not a valid positive amount.`,
        ),
      );
    }
  }

  // --- Currency ------------------------------------------------------------
  const currency = canonicalCurrency(proposal.currencyInput);
  if (proposal.currencyInput.trim() === "") {
    if (hasAmount) {
      issues.push(
        error(
          "MISSING_CURRENCY",
          "currency",
          "No currency stated — I need to know which token to use (SUI, USDC or MOV).",
        ),
      );
    } else {
      issues.push(
        warning(
          "UNKNOWN",
          "currency",
          "No currency stated — I'll need the amount and token (SUI, USDC or MOV).",
        ),
      );
    }
  } else if (currency === "UNKNOWN") {
    issues.push(
      error(
        "UNSUPPORTED_CURRENCY",
        "currency",
        `"${proposal.currencyInput}" is not a supported currency — MOVA settles SUI, USDC or MOV on Sui.`,
      ),
    );
  } else if (currency === "USD" || currency === "MYR" || currency === "EUR" || currency === "SGD" || currency === "GBP" || currency === "AUD" || currency === "JPY" || currency === "IDR" || currency === "THB" || currency === "PHP" || currency === "VND" || currency === "HKD") {
    issues.push(
      warning(
        "UNSUPPORTED_CURRENCY",
        "currency",
        `${currency} is fiat — a conversion to a Sui token (USDC or SUI) is required at settlement.`,
      ),
    );
  }

  // --- Recipient -----------------------------------------------------------
  const r = proposal.recipient;
  const recipientEmpty = !r || r.value.trim() === "" || r.type === "ADDRESS" && r.value === "";
  if (recipientEmpty) {
    issues.push(error("MISSING_RECIPIENT", "recipient", "No recipient found — who should receive this payment?"));
  } else if (r.ambiguous) {
    issues.push(
      error(
        "AMBIGUOUS_RECIPIENT",
        "recipient",
        `"${r.value}" is ambiguous — I can't tell which address should receive the payment.`,
      ),
    );
  } else if (r.type === "ADDRESS" && !isValidSuiAddress(r.value)) {
    issues.push(
      error(
        "INVALID_ADDRESS",
        "recipient",
        `"${r.value}" is not a valid Sui address (expected 0x…).`,
      ),
    );
  }

  // --- Network -------------------------------------------------------------
  if (proposal.networkMentioned === "unsupported") {
    issues.push(
      error(
        "UNSUPPORTED_NETWORK",
        "network",
        "That network is not supported — MOVA settles on Sui only.",
      ),
    );
  }

  // --- Conflicts (from extraction / follow-up merge) -----------------------
  for (const conflict of proposal.conflicts) {
    issues.push(
      error(
        "CONFLICTING_INSTRUCTIONS",
        "instruction",
        `Conflicting instructions: ${conflict}`,
      ),
    );
  }

  // --- Payment method ------------------------------------------------------
  if (proposal.paymentMethod === "UNKNOWN") {
    issues.push(
      warning(
        "UNSUPPORTED_PAYMENT_METHOD",
        "paymentMethod",
        "That payment method isn't available on Sui — the payment will use your wallet balance.",
      ),
    );
  }

  // --- Clarification state -------------------------------------------------
  // The validator is the AUTHORITY on clarification: it recomputes from the
  // merged field state so a follow-up that fills a previously-missing field
  // ("in USDC", "make it 300") never inherits a stale question.
  const errors = issues.filter((i) => i.severity === "ERROR");
  const warnings = issues.filter((i) => i.severity === "WARNING");
  const needsClarification = errors.some((e) =>
    ["MISSING_AMOUNT", "MISSING_CURRENCY", "MISSING_RECIPIENT", "AMBIGUOUS_RECIPIENT", "UNSUPPORTED_CURRENCY", "UNSUPPORTED_NETWORK"].includes(e.code),
  );

  const clarificationQuestion = needsClarification ? firstClarification(errors) : null;

  // --- Canonical amount ----------------------------------------------------
  const canonical = computeCanonicalAmount(proposal.amountRaw, proposal.currencyInput);
  const canonicalAmount = canonical?.money ?? null;

  return {
    ok: errors.length === 0,
    proposal,
    canonicalAmount,
    issues,
    errors,
    warnings,
    needsClarification,
    clarificationQuestion,
  };
}

function firstClarification(errors: ValidationIssue[]): string | null {
  const err = errors[0];
  if (!err) return null;
  switch (err.code) {
    case "MISSING_AMOUNT":
      return "How much would you like to send, and in which token (SUI, USDC, MOV)?";
    case "MISSING_CURRENCY":
      return "Which token should I use — SUI, USDC or MOV?";
    case "MISSING_RECIPIENT":
      return "Who should receive the payment? Paste a Sui address (0x…), email, or @handle.";
    case "AMBIGUOUS_RECIPIENT":
      return "Which recipient did you mean? Paste the exact Sui address (0x…), email, or @handle.";
    case "UNSUPPORTED_CURRENCY":
      return "Which token should I use — SUI, USDC or MOV?";
    case "UNSUPPORTED_NETWORK":
      return "MOVA settles on Sui only — which Sui network (testnet, devnet, mainnet)?";
    default:
      return "Please clarify the payment details so MOVA can build a valid intent.";
  }
}
