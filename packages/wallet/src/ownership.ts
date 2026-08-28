/**
 * MOVA Sui ownership model (deterministic).
 *
 * Ownership is central to MOVA: every piece of payment state is anchored to a
 * Sui address the user controls. In Phase 1 the anchor is the connected wallet
 * address and the records are deterministic in-app state; Phase 2 mirrors them
 * as Sui-owned Move objects (see `contracts/mova/mova_owned.move`):
 *
 *   User ownership   → the Sui address (`OwnershipAnchor`) + a signature proof
 *   Payment authz    → `PaymentAuthz` (human-approved, wallet-scoped, nonce'd)
 *   Payment records  → `PaymentRecord` (deterministic state-machine record)
 *   Txn receipts     → `PaymentReceipt` (issued only after SETTLED)
 *
 * These helpers are PURE and deterministic so they can be unit-tested and
 * reused by any adapter. They never touch a chain.
 */
import { MovaError, ErrorCode } from "@mova/logger";
import type {
  ApprovalDecision,
  IntentAction,
  Money,
  Network,
  RecipientType,
  TransactionStatus,
} from "@mova/types";
import {
  type OwnershipAnchor,
  type OwnershipProof,
  type OwnershipProofRequest,
  type PaymentAuthz,
  type PaymentReceipt,
  type PaymentRecord,
  type PaymentSettlement,
  type SuiAddress,
} from "./types.js";

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

export function isSuiAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value) || /^0x[0-9a-fA-F]{1,63}$/.test(value);
}

/** Normalize an address to lowercase hex (comparison-safe). */
export function normalizeAddress(address: SuiAddress): SuiAddress {
  return address.toLowerCase();
}

export function addressesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeAddress(a) === normalizeAddress(b);
}

export function createOwnershipAnchor(address: SuiAddress): OwnershipAnchor {
  if (!isSuiAddress(address)) {
    throw new MovaError(ErrorCode.OWNERSHIP_MISMATCH, `not a valid Sui address: ${address}`);
  }
  return { address: normalizeAddress(address) };
}

// ---------------------------------------------------------------------------
// Ownership proof (Sign-In-With-Sui style personal-message signature)
// ---------------------------------------------------------------------------

const NONCE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Random single-use nonce (crypto-secure when available). */
export function randomNonce(byteLength = 16): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint8Array(byteLength);
    crypto.getRandomValues(buf);
    return Array.from(buf)
      .map((b) => NONCE_CHARS[b % NONCE_CHARS.length])
      .join("");
  }
  // Deterministic fallback for non-browser runtimes (tests) — not for real auth.
  let out = "";
  for (let i = 0; i < byteLength; i += 1) {
    out += NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)];
  }
  return out;
}

export function buildOwnershipProofRequest(
  address: SuiAddress,
  nonce: string | null = null,
): OwnershipProofRequest {
  const anchor = createOwnershipAnchor(address);
  return {
    address: anchor.address,
    message:
      `MOVA ownership proof\n` +
      `Address: ${anchor.address}\n` +
      `Nonce: ${nonce ?? randomNonce()}\n` +
      `Signed at: ${new Date().toISOString()}`,
    nonce: nonce ?? randomNonce(),
  };
}

/** Local checks on a returned proof (before cryptographic verification). */
export function validateOwnershipProof(
  proof: OwnershipProof,
  expectedAddress: SuiAddress,
  expectedNonce: string | null,
  maxAgeMs = 5 * 60 * 1000,
): { ok: boolean; reason: string | null } {
  if (!addressesEqual(proof.address, expectedAddress)) {
    return { ok: false, reason: "proof address does not match the connected address" };
  }
  if (expectedNonce && proof.nonce !== expectedNonce) {
    return { ok: false, reason: "proof nonce does not match the issued challenge" };
  }
  if (proof.signature.length === 0) {
    return { ok: false, reason: "proof has no signature" };
  }
  if (Date.now() - proof.signedAt > maxAgeMs) {
    return { ok: false, reason: "ownership proof is stale" };
  }
  return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// Payment authz (human approval → wallet-scoped authority)
// ---------------------------------------------------------------------------

export interface IssuePaymentAuthzParams {
  paymentRecordId: string;
  ownerAddress: SuiAddress;
  action: IntentAction;
  amount: Money;
  recipient: string;
  network: Network;
  /** The deterministic approval decision that authorizes this. */
  approvalDecision: ApprovalDecision;
  /** Correlation nonce from the approval (single-use). */
  approvalNonce: string;
  /**
   * Digest of the deterministic TransactionSpec the human approved. Execution
   * verifies the rebuilt spec's digest matches this before submitting.
   */
  specDigest?: string | null;
  issuedAt?: number;
  /** Lifetime of the authority (default 15 minutes). */
  ttlMs?: number;
}

/**
 * Issue a payment authorization. This is the ONLY way a `PaymentAuthz` is
 * created and it REQUIRES an explicit human APPROVE decision — an AI
 * suggestion or a missing approval can never produce one.
 */
export function issuePaymentAuthz(params: IssuePaymentAuthzParams): PaymentAuthz {
  if (params.approvalDecision !== "APPROVE") {
    throw new MovaError(
      ErrorCode.APPROVAL_TOKEN_INVALID,
      "cannot issue payment authz without an APPROVE human decision",
    );
  }
  if (!isSuiAddress(params.ownerAddress)) {
    throw new MovaError(ErrorCode.OWNERSHIP_MISMATCH, "authz owner is not a valid Sui address");
  }
  if (!params.amount.amount || Number(params.amount.amount) <= 0) {
    throw new MovaError(ErrorCode.APPROVAL_TOKEN_INVALID, "authz requires a positive amount");
  }
  const issuedAt = params.issuedAt ?? Date.now();
  return {
    id: `authz_${params.approvalNonce}_${issuedAt}`,
    paymentRecordId: params.paymentRecordId,
    ownerAddress: normalizeAddress(params.ownerAddress),
    action: params.action,
    amount: params.amount,
    recipient: params.recipient,
    network: params.network,
    nonce: params.approvalNonce,
    specDigest: params.specDigest ?? null,
    issuedAt,
    expiresAt: issuedAt + (params.ttlMs ?? 15 * 60 * 1000),
    decision: "APPROVED",
  };
}

export interface VerifyPaymentAuthzParams {
  authz: PaymentAuthz | null;
  paymentRecordId: string;
  ownerAddress: SuiAddress;
  now?: number;
}

export type AuthzCheckCode =
  | "OK"
  | "MISSING"
  | "OWNER_MISMATCH"
  | "RECORD_MISMATCH"
  | "EXPIRED"
  | "NOT_APPROVED";

export function verifyPaymentAuthz(params: VerifyPaymentAuthzParams): {
  ok: boolean;
  code: AuthzCheckCode;
  reason: string;
} {
  const now = params.now ?? Date.now();
  const authz = params.authz;
  if (!authz) {
    return { ok: false, code: "MISSING", reason: "no payment authz present" };
  }
  if (authz.decision !== "APPROVED") {
    return { ok: false, code: "NOT_APPROVED", reason: "authz decision is not APPROVED" };
  }
  if (!addressesEqual(authz.ownerAddress, params.ownerAddress)) {
    return { ok: false, code: "OWNER_MISMATCH", reason: "authz belongs to a different owner" };
  }
  if (authz.paymentRecordId !== params.paymentRecordId) {
    return { ok: false, code: "RECORD_MISMATCH", reason: "authz is bound to a different payment" };
  }
  if (authz.expiresAt <= now) {
    return { ok: false, code: "EXPIRED", reason: "payment authz has expired" };
  }
  return { ok: true, code: "OK", reason: "payment authz is valid" };
}

// ---------------------------------------------------------------------------
// Payment records & receipts
// ---------------------------------------------------------------------------

export function createPaymentRecord(input: {
  id: string;
  correlationId: string;
  ownerAddress: SuiAddress;
  rawText: string;
  action: IntentAction;
  amount: Money;
  recipient: { type: RecipientType; value: string; name: string | null };
  network: Network;
  memo: string | null;
  state: "CREATED";
  createdAt: number;
}): PaymentRecord {
  return {
    id: input.id,
    correlationId: input.correlationId,
    ownerAddress: normalizeAddress(input.ownerAddress),
    rawText: input.rawText,
    action: input.action,
    amount: input.amount,
    recipient: input.recipient,
    network: input.network,
    memo: input.memo,
    state: "CREATED",
    validated: false,
    approval: null,
    authz: null,
    settlement: null,
    execution: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

/** Issue a receipt — ONLY after the record reached SETTLED. */
export function issuePaymentReceipt(input: {
  paymentRecordId: string;
  ownerAddress: SuiAddress;
  amount: Money;
  recipient: string;
  network: Network;
  state: string;
  txDigest: string | null;
  simulated: boolean;
  issuedAt?: number;
}): PaymentReceipt {
  if (input.state !== "SETTLED") {
    throw new MovaError(
      ErrorCode.APPROVAL_TOKEN_INVALID,
      "cannot issue a receipt until the payment is SETTLED",
    );
  }
  return {
    id: `receipt_${input.paymentRecordId}`,
    paymentRecordId: input.paymentRecordId,
    ownerAddress: normalizeAddress(input.ownerAddress),
    amount: input.amount,
    recipient: input.recipient,
    network: input.network,
    txDigest: input.txDigest,
    simulated: input.simulated,
    issuedAt: input.issuedAt ?? Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Settlement outcome builder (kept here so the wallet layer owns the shape)
// ---------------------------------------------------------------------------

export function settlementOutcome(
  input: {
    status: TransactionStatus;
    simulated: boolean;
    txDigest: string | null;
    error: string | null;
    signedBy: SuiAddress | null;
    signedAt: number | null;
  },
): PaymentSettlement {
  return { ...input };
}
