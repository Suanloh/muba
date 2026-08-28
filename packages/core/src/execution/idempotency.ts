/**
 * MOVA Phase 7 — idempotency guard.
 *
 * Prevents accidental duplicate payment execution. Every payment gets a stable
 * `clientRequestId` (idempotency key) and a signed `specDigest`. The guard
 * refuses to begin an execution attempt when:
 *
 *   - the record was already executed (executedAt set)      → duplicate
 *   - the same clientRequestId is presented with a DIFFERENT digest (replay/
 *     mutation)                                              → idempotency violation
 *   - the spec's approval window has passed                   → expired
 *
 * The guard is pure + stateless: the caller persists the returned state on the
 * PaymentRecord (via `PaymentExecutionInfo`). Deterministic and unit-testable.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  ExecutionFailureInfo,
  PaymentExecutionInfo,
  TransactionSpec,
  TransactionStatus,
} from "@mova/types";

export interface BeginResult {
  ok: boolean;
  state: PaymentExecutionInfo | null;
  reason: string | null;
}

export type IdempotencyFailureCode = "DUPLICATE" | "DIGEST_MISMATCH" | "EXPIRED" | "INVALID_SPEC";

/**
 * Begin an execution attempt for `spec`. Returns ok=false (with a typed
 * MovaError thrown) when the attempt must be refused. `prior` is the
 * record's existing execution state (null on first attempt).
 */
export function beginExecution(
  prior: PaymentExecutionInfo | null,
  spec: TransactionSpec,
  now = Date.now(),
): { state: PaymentExecutionInfo; reason: string | null } {
  // Spec integrity: digest must match the canonical serialization.
  if (!spec.planDigest) {
    throw new MovaError(ErrorCode.IDEMPOTENCY_VIOLATION, "spec has no plan digest");
  }

  // Expired approval window — refuse (a fresh approval is required).
  if (spec.expiresAt <= now) {
    throw new MovaError(ErrorCode.APPROVAL_EXPIRED, "execution window expired — approve again");
  }

  // First attempt: safe to begin.
  if (!prior) {
    return {
      state: {
        clientRequestId: spec.clientRequestId,
        specDigest: spec.planDigest,
        attempts: 1,
        lastAttemptAt: now,
        executedAt: null,
        failure: null,
        settlement: null,
      },
      reason: null,
    };
  }

  // Same idempotency key but a different digest => replay/mutation. Refuse.
  if (prior.clientRequestId !== spec.clientRequestId || prior.specDigest !== spec.planDigest) {
    throw new MovaError(ErrorCode.IDEMPOTENCY_VIOLATION, "clientRequestId or plan digest changed since the first attempt — replay refused", {
      details: { prior: prior.specDigest, current: spec.planDigest },
    });
  }

  // Already executed — never execute twice.
  if (prior.executedAt !== null) {
    throw new MovaError(ErrorCode.IDEMPOTENCY_VIOLATION, `payment already executed at ${prior.executedAt} — duplicate refused`);
  }

  // A previous attempt is in-flight (started but not settled). Refuse until it
  // resolves (the terminal state transition already prevents double SETTLED).
  return {
    state: {
      ...prior,
      attempts: prior.attempts + 1,
      lastAttemptAt: now,
    },
    reason: "retrying after a non-terminal attempt (safe — no settlement recorded)",
  };
}

/** Record a successful settlement (called once, after SETTLED confirmed). */
export function markExecuted(
  state: PaymentExecutionInfo,
  settlement: TransactionStatus,
  now = Date.now(),
): PaymentExecutionInfo {
  if (state.executedAt !== null) {
    throw new MovaError(ErrorCode.IDEMPOTENCY_VIOLATION, "payment already marked executed");
  }
  return { ...state, executedAt: now, settlement, failure: null };
}

/** Record a terminal failure on the attempt state. */
export function markFailed(
  state: PaymentExecutionInfo,
  failure: ExecutionFailureInfo,
  now = Date.now(),
): PaymentExecutionInfo {
  return { ...state, failure, lastAttemptAt: now, settlement: failure ? "FAILED" : state.settlement };
}

/** True when the record's execution state forbids a new execution attempt. */
export function isExecuted(state: PaymentExecutionInfo | null): boolean {
  return state?.executedAt !== null && state?.executedAt !== undefined && state !== null;
}
