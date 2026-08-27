/**
 * @mova/wallet — shared wallet-facing types (framework-agnostic).
 *
 * These describe wallet connection state, Sui network state, and the
 * signature/submission shapes the wallet layer uses. The React adapter
 * (`apps/web`) maps `@mysten/dapp-kit` onto these types.
 *
 * Safety rule: nothing in this package signs or submits a transaction unless a
 * `WalletExecutionGate` verdict (`gate.ts`) permits it. See `docs/ownership.md`.
 */
import type {
  ApprovalDecision,
  IntentAction,
  Money,
  Network,
  PaymentState,
  RecipientType,
  TransactionStatus,
} from "@mova/types";

/** A Sui address (0x…). The root of MOVA ownership. */
export type SuiAddress = string;

// ---------------------------------------------------------------------------
// Wallet connection
// ---------------------------------------------------------------------------

export interface WalletAccount {
  address: SuiAddress;
  /** Human label if the wallet exposes one. */
  label: string | null;
  /** Chain IDs the account is active on, e.g. ["sui:testnet"]. */
  chains: string[];
  /** Public key bytes if exposed by the wallet. */
  publicKey: Uint8Array | null;
}

export type WalletConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface WalletConnectionState {
  status: WalletConnectionStatus;
  account: WalletAccount | null;
  /** Name of the connected wallet provider (e.g. "Sui Wallet"). */
  providerName: string | null;
  error: string | null;
  connectedAt: number | null;
}

// ---------------------------------------------------------------------------
// Sui network state
// ---------------------------------------------------------------------------

export interface MovaNetworkState {
  /** Expected network per the MOVA runtime boundary. */
  expected: Network;
  /** Raw chain id reported by the wallet, e.g. "sui:testnet" (null if unknown). */
  detectedChain: string | null;
  /** Resolved MOVA network for the detected chain (null if unrecognized). */
  detectedNetwork: Network | null;
  /** True when the wallet chain matches the expected MOVA network. */
  matches: boolean;
  /** True when the wallet chain could not be determined or recognized. */
  unknown: boolean;
}

// ---------------------------------------------------------------------------
// Signatures (ownership proof / wallet authz)
// ---------------------------------------------------------------------------

export interface SignatureResult {
  address: SuiAddress;
  /** Exact bytes that were signed (utf-8 string form). */
  message: string;
  /** base64-encoded signature bytes returned by the wallet. */
  signature: string;
  signedAt: number;
}

// ---------------------------------------------------------------------------
// Gated transaction submission (Phase 2+ wires real PTBs through here)
// ---------------------------------------------------------------------------

export interface GatedTransactionRequest {
  /**
   * The gate verdict authorizing this submission. MUST be `allowed === true`.
   * Adapters refuse to proceed otherwise — this is the safety boundary.
   */
  gateVerdict: { allowed: true; code: "PASS"; reason: string };
  /** Serialized transaction block bytes (base64). */
  bytes: string;
  /** The owner address authorizing the transaction. */
  ownerAddress: SuiAddress;
}

export interface GatedTransactionResult {
  ok: boolean;
  /** Real Sui digest, or null when simulated (never fabricated). */
  digest: string | null;
  simulated: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Ownership model (see docs/ownership.md + contracts/mova/mova_owned.move)
// ---------------------------------------------------------------------------

/** The user's Sui address is the ownership anchor for all MOVA-owned state. */
export interface OwnershipAnchor {
  address: SuiAddress;
}

/** Challenge used to prove an address controls a key (Sign-In-With-Sui style). */
export interface OwnershipProofRequest {
  address: SuiAddress;
  /** Human-readable message the wallet is asked to sign. */
  message: string;
  /** Single-use nonce to prevent replay. */
  nonce: string;
}

/** Result of the ownership proof: an address signature over the challenge. */
export interface OwnershipProof {
  address: SuiAddress;
  message: string;
  nonce: string;
  /** base64 signature bytes. */
  signature: string;
  signedAt: number;
}

/**
 * Payment authorization — the wallet-scoped, human-approved authority to
 * execute ONE payment. Issued ONLY from an APPROVED approval decision
 * (never from an AI suggestion). Phase 2 mirrors this as a Sui-owned
 * `MovaPaymentAuthz` object owned by `ownerAddress`.
 */
export interface PaymentAuthz {
  id: string;
  paymentRecordId: string;
  ownerAddress: SuiAddress;
  action: IntentAction;
  amount: Money;
  recipient: string;
  network: Network;
  /** Single-use, correlated to the approval decision. */
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  decision: "APPROVED";
}

/** A minimal view of the approval request consumed by the wallet layer. */
export interface ApprovalView {
  status: string;
  decision: ApprovalDecision | null;
  resolvedAt: number | null;
  reason: string;
}

/**
 * A payment record — the deterministic in-app record of one payment flow.
 * The ownership model anchors it to `ownerAddress`; Phase 2 mirrors settled
 * records as Sui-owned `OwnedPaymentRecord` objects (see contracts/mova).
 */
export interface PaymentRecord {
  id: string;
  correlationId: string;
  ownerAddress: SuiAddress;
  rawText: string;
  action: IntentAction;
  amount: Money;
  recipient: { type: RecipientType; value: string; name: string | null };
  network: Network;
  memo: string | null;
  state: PaymentState;
  /** Deterministic validator result (AI suggestions are never trusted). */
  validated: boolean;
  approval: ApprovalView | null;
  authz: PaymentAuthz | null;
  settlement: PaymentSettlement | null;
  createdAt: number;
  updatedAt: number;
}

export interface PaymentSettlement {
  status: TransactionStatus;
  simulated: boolean;
  /** Real Sui digest, or null when simulated. */
  txDigest: string | null;
  /** The address that authorized the (gated) submission via the wallet. */
  signedBy: SuiAddress | null;
  signedAt: number | null;
  error: string | null;
}

/**
 * A payment receipt — issued only after SETTLED. Phase 2 mints a Sui-owned
 * `MovaReceipt` object owned by `ownerAddress` carrying these fields.
 */
export interface PaymentReceipt {
  id: string;
  paymentRecordId: string;
  ownerAddress: SuiAddress;
  amount: Money;
  recipient: string;
  network: Network;
  txDigest: string | null;
  simulated: boolean;
  issuedAt: number;
}
