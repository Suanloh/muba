/**
 * MOVA Phase 7 — deterministic transaction plan construction.
 *
 * Builds a `TransactionSpec` (the signed-against execution plan) from VALIDATED
 * state only — recipient, amount in smallest units, network, and the selected
 * deterministic route. It NEVER accepts raw LLM output or mutable UI state:
 * every field is re-checked here and the plan digest is a stable SHA-256 over
 * the canonical field set.
 *
 * The human approves the `planDigest`; the wallet authz records it; execution
 * re-builds the spec from validated state and VERIFIES the digest matches
 * before constructing any on-chain transaction.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  IntentAction,
  Money,
  Network,
  TransactionSpec,
  TransactionSpecKind,
} from "@mova/types";
import { isValidSuiAddress } from "@mova/types";
import { sha256Hex } from "./sha256.js";

export const PLAN_VERSION = "1" as const;

export interface BuildSpecInput {
  clientRequestId: string;
  recordId: string;
  correlationId: string;
  sender: string;
  recipient: string;
  amount: Money;
  network: Network;
  routeId: string;
  fees: Money;
  totalCost: Money;
  kind?: TransactionSpecKind;
  createdAt?: number;
  /** Execution window / approval TTL (default 15 minutes). */
  ttlMs?: number;
}

/** Validate the recipient is a real Sui address (deterministic, fail-closed). */
export function assertValidRecipient(recipient: string): void {
  if (!isValidSuiAddress(recipient)) {
    throw new MovaError(
      ErrorCode.INTENT_VALIDATION_FAILED,
      `invalid Sui recipient: ${recipient}`,
    );
  }
}

/** Canonical field order used for the digest — DO NOT reorder. */
export function canonicalSpec(spec: Omit<TransactionSpec, "planDigest">): string {
  return [
    `v:${spec.version}`,
    `kind:${spec.kind}`,
    `cid:${spec.clientRequestId}`,
    `rec:${spec.recordId}`,
    `corr:${spec.correlationId}`,
    `sender:${spec.sender.toLowerCase()}`,
    `recipient:${spec.recipient.toLowerCase()}`,
    `amount:${spec.amount.amount}:${spec.amount.asset}`,
    `network:${spec.network}`,
    `route:${spec.routeId}`,
    `fees:${spec.fees.amount}:${spec.fees.asset}`,
    `total:${spec.totalCost.amount}:${spec.totalCost.asset}`,
    `created:${spec.createdAt}`,
    `expires:${spec.expiresAt}`,
  ].join("|");
}

/** Stable SHA-256 digest of the canonical spec (hex). */
export function planDigest(spec: Omit<TransactionSpec, "planDigest">): string {
  return sha256Hex(canonicalSpec(spec));
}

/**
 * Build the deterministic transaction spec. Throws when any validated-state
 * field is missing/invalid (fail-closed — never emit a partial plan).
 */
export function buildTransactionSpec(input: BuildSpecInput): TransactionSpec {
  assertValidRecipient(input.recipient);
  if (!isValidSuiAddress(input.sender)) {
    throw new MovaError(ErrorCode.OWNERSHIP_MISMATCH, `invalid sender address: ${input.sender}`);
  }
  if (BigInt(input.amount.amount) <= 0n) {
    throw new MovaError(ErrorCode.INTENT_VALIDATION_FAILED, "spec requires a positive amount");
  }
  if (!input.amount.asset || !input.fees.asset || !input.totalCost.asset) {
    throw new MovaError(ErrorCode.INTENT_VALIDATION_FAILED, "spec requires asset labels on money fields");
  }
  if (!input.routeId) {
    throw new MovaError(ErrorCode.ROUTING_FAILED, "spec requires a selected route id");
  }

  const now = input.createdAt ?? Date.now();
  const ttlMs = input.ttlMs ?? 15 * 60 * 1000;
  const base: Omit<TransactionSpec, "planDigest"> = {
    version: PLAN_VERSION,
    kind: input.kind ?? "NATIVE_TRANSFER",
    clientRequestId: input.clientRequestId,
    recordId: input.recordId,
    correlationId: input.correlationId,
    sender: input.sender.toLowerCase(),
    recipient: input.recipient.toLowerCase(),
    amount: input.amount,
    network: input.network,
    routeId: input.routeId,
    fees: input.fees,
    totalCost: input.totalCost,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  return { ...base, planDigest: planDigest(base) };
}

/** Verify a spec's digest is intact (integrity check before execution). */
export function assertSpecIntegrity(spec: TransactionSpec): { ok: boolean; reason: string | null } {
  const recomputed = planDigest(spec);
  if (recomputed !== spec.planDigest) {
    return { ok: false, reason: "plan digest mismatch — spec was mutated after approval" };
  }
  return { ok: true, reason: null };
}

/**
 * Verify the authz was issued for EXACTLY this spec digest. The human approved
 * a specific digest; if the rebuilt spec differs, execution is refused.
 */
export function assertAuthzMatchesSpec(spec: TransactionSpec, authzSpecDigest: string | null): void {
  if (!authzSpecDigest) {
    throw new MovaError(
      ErrorCode.EXECUTION_GATE_BLOCKED,
      "approval authz carries no plan digest — refusing execution",
    );
  }
  if (authzSpecDigest !== spec.planDigest) {
    throw new MovaError(
      ErrorCode.EXECUTION_GATE_BLOCKED,
      "plan digest changed since approval — refusing execution",
      { details: { approved: authzSpecDigest, current: spec.planDigest } },
    );
  }
}

/** Human-readable summary of what a spec will do (for confirmation UI). */
export function summarizeSpec(spec: TransactionSpec): string {
  return [
    `Execute ${spec.amount.amount} ${spec.amount.asset}`,
    `to ${spec.recipient}`,
    `on ${spec.network}`,
    `via route ${spec.routeId}`,
    `(fees ${spec.fees.amount} ${spec.fees.asset}, total ${spec.totalCost.amount} ${spec.totalCost.asset})`,
    `digest ${spec.planDigest.slice(0, 16)}…`,
  ].join(" · ");
}

/** Stable human label used for intent-action → spec kind mapping. */
export function specKindForAction(action: IntentAction): TransactionSpecKind {
  return action === "PAY" || action === "TRANSFER" ? "NATIVE_TRANSFER" : "TOKEN_TRANSFER";
}
