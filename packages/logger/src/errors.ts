/**
 * MOVA typed errors.
 *
 * Every failure path throws a `MovaError` with a stable machine-readable `code`.
 * Callers fail fast and loudly; no error is silently swallowed. Errors that
 * move value or change a decision are also written to the audit trail.
 */

export const ErrorCode = {
  // Input / validation
  VALIDATION_ERROR: "ERR_VALIDATION",
  INTENT_VALIDATION_FAILED: "ERR_INTENT_VALIDATION",
  INTENT_AMBIGUOUS_RECIPIENT: "ERR_INTENT_RECIPIENT_AMBIGUOUS",
  INTENT_CONFLICTING_INSTRUCTIONS: "ERR_INTENT_CONFLICT",
  INTENT_UNSUPPORTED_CURRENCY: "ERR_INTENT_CURRENCY_UNSUPPORTED",
  NOT_FOUND: "ERR_NOT_FOUND",

  // Routing
  ROUTING_FAILED: "ERR_ROUTING_FAILED",

  // Compliance (fail-closed: unavailable => REVIEW/BLOCK)
  COMPLIANCE_BLOCKED: "ERR_COMPLIANCE_BLOCKED",
  COMPLIANCE_UNAVAILABLE: "ERR_COMPLIANCE_UNAVAILABLE",

  // Risk
  RISK_BLOCKED: "ERR_RISK_BLOCKED",

  // Approval
  APPROVAL_REQUIRED: "ERR_APPROVAL_REQUIRED",
  APPROVAL_REJECTED: "ERR_APPROVAL_REJECTED",
  APPROVAL_EXPIRED: "ERR_APPROVAL_EXPIRED",

  // Execution / settlement
  EXECUTION_SIMULATION_FAILED: "ERR_EXECUTION_SIMULATION",
  SETTLEMENT_FAILED: "ERR_SETTLEMENT_FAILED",
  SETTLEMENT_UNCONFIRMED: "ERR_SETTLEMENT_UNCONFIRMED",
  INSUFFICIENT_BALANCE: "ERR_INSUFFICIENT_BALANCE",
  BALANCE_QUERY_FAILED: "ERR_BALANCE_QUERY_FAILED",
  NETWORK_FAILURE: "ERR_NETWORK_FAILURE",
  EXECUTION_TIMEOUT: "ERR_EXECUTION_TIMEOUT",
  IDEMPOTENCY_VIOLATION: "ERR_IDEMPOTENCY_VIOLATION",

  // State machine
  STATE_TRANSITION_INVALID: "ERR_STATE_TRANSITION",

  // Integration / sponsor
  INTEGRATION_UNAVAILABLE: "ERR_INTEGRATION_UNAVAILABLE",
  MOCK_FORBIDDEN: "ERR_MOCK_FORBIDDEN",

  // Auth / config
  UNAUTHORIZED: "ERR_UNAUTHORIZED",
  FORBIDDEN: "ERR_FORBIDDEN",
  CONFIGURATION_ERROR: "ERR_CONFIGURATION",

  // Wallet / Sui ownership (packages/wallet)
  WALLET_NOT_CONNECTED: "ERR_WALLET_NOT_CONNECTED",
  WALLET_CONNECTION_FAILED: "ERR_WALLET_CONNECTION_FAILED",
  WALLET_NETWORK_MISMATCH: "ERR_WALLET_NETWORK_MISMATCH",
  WALLET_SIGNING_FAILED: "ERR_WALLET_SIGNING_FAILED",
  WALLET_USER_REJECTED: "ERR_WALLET_USER_REJECTED",
  WALLET_UNSUPPORTED_ACTION: "ERR_WALLET_UNSUPPORTED_ACTION",
  APPROVAL_TOKEN_INVALID: "ERR_APPROVAL_TOKEN_INVALID",
  OWNERSHIP_MISMATCH: "ERR_OWNERSHIP_MISMATCH",
  EXECUTION_GATE_BLOCKED: "ERR_EXECUTION_GATE_BLOCKED",

  INTERNAL_ERROR: "ERR_INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface MovaErrorOptions {
  /** Stable flow identifier for traceability. */
  correlationId?: string;
  /** Extra structured detail (never secrets). */
  details?: unknown;
  cause?: unknown;
}

export class MovaError extends Error {
  readonly code: ErrorCode;
  readonly correlationId?: string;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: MovaErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "MovaError";
    this.code = code;
    this.correlationId = options.correlationId;
    this.details = options.details;
  }
}

/** Convenience factories. */

export function validationError(message: string, opts?: MovaErrorOptions): MovaError {
  return new MovaError(ErrorCode.VALIDATION_ERROR, message, opts);
}

export function complianceBlocked(message: string, opts?: MovaErrorOptions): MovaError {
  return new MovaError(ErrorCode.COMPLIANCE_BLOCKED, message, opts);
}

export function settlementFailed(message: string, opts?: MovaErrorOptions): MovaError {
  return new MovaError(ErrorCode.SETTLEMENT_FAILED, message, opts);
}

/** Log-safe representation of any thrown value (never includes secrets). */
export function toErrorSummary(err: unknown): {
  name: string;
  code: string;
  message: string;
} {
  if (err instanceof MovaError) {
    return { name: err.name, code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { name: err.name, code: ErrorCode.INTERNAL_ERROR, message: err.message };
  }
  return { name: "UnknownError", code: ErrorCode.INTERNAL_ERROR, message: String(err) };
}
