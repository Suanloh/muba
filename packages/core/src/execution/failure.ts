/**
 * MOVA Phase 7 — execution failure classification.
 *
 * Maps any thrown error / settlement outcome into the structured
 * `ExecutionFailureInfo` taxonomy so the UI can tell the user exactly what
 * happened and whether retrying the same logical payment is safe.
 *
 * Classifications (deterministic):
 *   - Human/wallet declines  → USER_REJECTED
 *   - Pre-flight balance     → INSUFFICIENT_BALANCE
 *   - Network / RPC / wallet  → NETWORK_FAILURE
 *   - Bad destination        → INVALID_RECIPIENT
 *   - On-chain submission    → TRANSACTION_FAILED
 *   - No confirmation in time → TIMEOUT
 *   - External engine down   → INTEGRATION_UNAVAILABLE
 *   - Duplicate/replayed     → IDEMPOTENCY_VIOLATION
 *   - Approval window passed → APPROVAL_EXPIRED
 *   - Anything else          → UNKNOWN (never hides the original message)
 */
import { ErrorCode, MovaError } from "@mova/logger";
import type {
  ExecutionFailureCode,
  ExecutionFailureInfo,
  ExecutionStage,
  TransactionStatus,
} from "@mova/types";

export interface ClassifyOptions {
  stage?: ExecutionStage;
  txDigest?: string | null;
  at?: number;
  /** When set, overrides the stage for timeout/integration failures. */
  retryableOverride?: boolean;
}

const CODE_TO_FAILURE: Partial<Record<ErrorCode, ExecutionFailureCode>> = {
  // Human / wallet decisions
  ERR_APPROVAL_REJECTED: "USER_REJECTED",
  ERR_WALLET_USER_REJECTED: "USER_REJECTED",
  ERR_APPROVAL_REQUIRED: "USER_REJECTED",
  // Balance
  ERR_INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  ERR_BALANCE_QUERY_FAILED: "INSUFFICIENT_BALANCE",
  // Network
  ERR_NETWORK_FAILURE: "NETWORK_FAILURE",
  ERR_WALLET_NETWORK_MISMATCH: "NETWORK_FAILURE",
  ERR_WALLET_NOT_CONNECTED: "NETWORK_FAILURE",
  ERR_WALLET_CONNECTION_FAILED: "NETWORK_FAILURE",
  // Recipient / validation
  ERR_INTENT_VALIDATION: "INVALID_RECIPIENT",
  ERR_INTENT_RECIPIENT_AMBIGUOUS: "INVALID_RECIPIENT",
  ERR_INTENT_CONFLICT: "INVALID_RECIPIENT",
  // Transaction / settlement
  ERR_SETTLEMENT_FAILED: "TRANSACTION_FAILED",
  ERR_SETTLEMENT_UNCONFIRMED: "TRANSACTION_FAILED",
  ERR_EXECUTION_SIMULATION: "TRANSACTION_FAILED",
  ERR_EXECUTION_GATE_BLOCKED: "TRANSACTION_FAILED",
  ERR_WALLET_SIGNING_FAILED: "TRANSACTION_FAILED",
  ERR_WALLET_UNSUPPORTED_ACTION: "TRANSACTION_FAILED",
  ERR_STATE_TRANSITION: "TRANSACTION_FAILED",
  // Timeout
  ERR_EXECUTION_TIMEOUT: "TIMEOUT",
  // Integration availability
  ERR_INTEGRATION_UNAVAILABLE: "INTEGRATION_UNAVAILABLE",
  ERR_COMPLIANCE_UNAVAILABLE: "INTEGRATION_UNAVAILABLE",
  ERR_ROUTING_FAILED: "INTEGRATION_UNAVAILABLE",
  ERR_RISK_BLOCKED: "INTEGRATION_UNAVAILABLE",
  ERR_COMPLIANCE_BLOCKED: "INTEGRATION_UNAVAILABLE",
  // Idempotency
  ERR_IDEMPOTENCY_VIOLATION: "IDEMPOTENCY_VIOLATION",
  ERR_APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  ERR_APPROVAL_TOKEN_INVALID: "IDEMPOTENCY_VIOLATION",
};

/** Retry-safe when there was no partial on-chain execution (no digest). */
function retryableFor(code: ExecutionFailureCode, txDigest: string | null | undefined): boolean {
  if (txDigest) return false; // a real submission happened — do NOT auto-retry
  switch (code) {
    case "USER_REJECTED":
      return true; // user can re-approve a fresh, corrected flow
    case "INSUFFICIENT_BALANCE":
      return true; // fund the wallet and retry
    case "NETWORK_FAILURE":
      return true; // reconnect / switch network and retry
    case "TIMEOUT":
      return true; // check the chain before retrying
    case "INTEGRATION_UNAVAILABLE":
      return true;
    default:
      return false; // TRANSACTION_FAILED / INVALID_RECIPIENT / IDEMPOTENCY / UNKNOWN
  }
}

/** Extract a MovaError code from any thrown value (null when not a MovaError). */
export function errorCodeOf(err: unknown): ErrorCode | null {
  if (err instanceof MovaError) return err.code;
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    const c = (err as { code: string }).code;
    if ((Object.values(ErrorCode) as string[]).includes(c)) return c as ErrorCode;
  }
  return null;
}

/**
 * Classify any failure into a structured ExecutionFailureInfo. Never throws —
 * the original message is always preserved.
 */
export function classifyExecutionFailure(
  err: unknown,
  opts: ClassifyOptions = {},
): ExecutionFailureInfo {
  const at = opts.at ?? Date.now();
  const stage = opts.stage ?? "EXECUTION";
  const code = errorCodeOf(err);

  let failureCode: ExecutionFailureCode = "UNKNOWN";
  if (code && CODE_TO_FAILURE[code]) {
    failureCode = CODE_TO_FAILURE[code]!;
  }

  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown execution failure";

  return {
    code: failureCode,
    stage,
    message,
    userActionable:
      failureCode === "USER_REJECTED" ||
      failureCode === "INSUFFICIENT_BALANCE" ||
      failureCode === "NETWORK_FAILURE" ||
      failureCode === "APPROVAL_EXPIRED",
    retryable: opts.retryableOverride ?? retryableFor(failureCode, opts.txDigest),
    errorCode: code ?? undefined,
    txDigest: opts.txDigest ?? null,
    at,
  };
}

/** Classify a settlement outcome (status + digest) into a failure (or null). */
export function classifySettlement(
  status: TransactionStatus,
  error: string | null,
  opts: { stage?: ExecutionStage; txDigest?: string | null; at?: number } = {},
): ExecutionFailureInfo | null {
  if (status === "CONFIRMED" || status === "SIMULATED") return null;
  const message = error ?? `Settlement ${status}`;
  if (status === "FAILED" || status === "REVERTED") {
    return classifyExecutionFailure(
      new MovaError(ErrorCode.SETTLEMENT_FAILED, message),
      { ...opts, txDigest: opts.txDigest ?? null },
    );
  }
  if (status === "SUBMITTED" || status === "PENDING") {
    return classifyExecutionFailure(
      new MovaError(ErrorCode.EXECUTION_TIMEOUT, `Settlement did not confirm (${status}): ${message}`),
      { ...opts, txDigest: opts.txDigest ?? null },
    );
  }
  return classifyExecutionFailure(
    new MovaError(ErrorCode.SETTLEMENT_UNCONFIRMED, message),
    opts,
  );
}

/** Short, honest user-facing message for a failure. */
export function failureUserMessage(f: ExecutionFailureInfo): string {
  switch (f.code) {
    case "USER_REJECTED":
      return "The payment was not approved — nothing was executed.";
    case "INSUFFICIENT_BALANCE":
      return `Insufficient balance: ${f.message}`;
    case "NETWORK_FAILURE":
      return `Network issue: ${f.message}`;
    case "INVALID_RECIPIENT":
      return `Invalid recipient: ${f.message}`;
    case "TRANSACTION_FAILED":
      return `Settlement failed: ${f.message}`;
    case "TIMEOUT":
      return `Settlement timed out: ${f.message}`;
    case "INTEGRATION_UNAVAILABLE":
      return `A MOVA engine was unavailable: ${f.message}`;
    case "IDEMPOTENCY_VIOLATION":
      return `Duplicate execution blocked: ${f.message}`;
    case "APPROVAL_EXPIRED":
      return `Approval expired: ${f.message}`;
    default:
      return f.message;
  }
}

/** Machine label for a failure code (for badges / logs). */
export function failureLabel(code: ExecutionFailureCode): string {
  return code.replace(/_/g, " ").toLowerCase();
}
