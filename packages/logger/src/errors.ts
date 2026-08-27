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

  // State machine
  STATE_TRANSITION_INVALID: "ERR_STATE_TRANSITION",

  // Integration / sponsor
  INTEGRATION_UNAVAILABLE: "ERR_INTEGRATION_UNAVAILABLE",
  MOCK_FORBIDDEN: "ERR_MOCK_FORBIDDEN",

  // Auth / config
  UNAUTHORIZED: "ERR_UNAUTHORIZED",
  FORBIDDEN: "ERR_FORBIDDEN",
  CONFIGURATION_ERROR: "ERR_CONFIGURATION",

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
