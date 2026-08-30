/**
 * @mova/integrations — MOVA programmable transaction block (PTB) builders.
 *
 * A single Sui programmable transaction block that BOTH pays the recipient
 * AND mints MOVA's on-chain ownership record (`OwnedPaymentRecord`) from the
 * published `mova_owned` Move module — all in ONE atomic, user-signed
 * transaction. This is the Phase 2 "owned payment" wiring: the value move and
 * the ownership mirror happen together, so a payment can never exist on-chain
 * without its deterministic MOVA record, and vice-versa.
 *
 * Safety:
 * - Builds ONLY from explicit, validated payload fields (never LLM output).
 * - The `&mut TxContext` argument is injected by the Sui runtime — the builder
 *   passes only the entry function's explicit arguments.
 * - The package id must resolve (fail closed) before any PTB is constructed.
 * - `mint_receipt` is a SEPARATE follow-up PTB (`buildMovaReceiptPtb`) because
 *   a receipt carries the transaction's own digest, which isn't known until
 *   after submission — a receipt can't be minted in the same block as the
 *   transfer without a fabricated digest.
 */
import { Transaction } from "@mysten/sui/transactions";
import { MovaError, ErrorCode } from "@mova/logger";
import type { SuiTransferPayload } from "./sui-settlement.js";

/** Explicit args for `mova_owned::record_payment` (on-chain record mirror). */
export interface MovaOwnedRecordArgs {
  /** MOVA correlation id (threads the whole flow). */
  correlationId: string;
  /** The raw validated payment text (e.g. "Pay Alice 20 USDC"). */
  rawText: string;
  /** Amount in SMALLEST units (MIST for SUI) as a decimal string (u64). */
  amountMist: string;
  /** Asset symbol, e.g. "SUI". */
  asset: string;
  /** Recipient Sui address. */
  recipient: string;
  /** MOVA network, e.g. "SUI_TESTNET". */
  network: string;
  /** On-chain state, e.g. "SETTLED". */
  state: string;
  /** Record created-at (epoch millis → u64). */
  createdAtMs: number;
}

/** A validated MOVA-owned native-SUI payment (transfer + on-chain record). */
export interface MovaOwnedTransferPayload extends Omit<SuiTransferPayload, "kind"> {
  kind: "MOVA_OWNED_TRANSFER";
  /** Published MOVA Move package id (`mova_owned` module lives here). */
  movaPackageId: string;
  /** `record_payment` args — the on-chain OwnedPaymentRecord for this payment. */
  record: MovaOwnedRecordArgs;
}

/** Explicit args for `mova_owned::mint_receipt` (post-settlement receipt). */
export interface MovaReceiptArgs {
  paymentRecordId: string;
  amountMist: string;
  asset: string;
  recipient: string;
  txDigest: string;
  simulated: boolean;
  issuedAtMs: number;
}

function requirePackageId(packageId: string): string {
  if (!packageId || !/^0x[0-9a-fA-F]{40,64}$/.test(packageId)) {
    throw new MovaError(
      ErrorCode.CONFIGURATION_ERROR,
      "MOVA_PACKAGE_ID is required (a published 0x… address) to build the MOVA-owned PTB",
    );
  }
  return packageId;
}

/**
 * Build the ONE-PTB MOVA payment: split native SUI → transfer to recipient →
 * mint `OwnedPaymentRecord` (owned by the sender) via `mova_owned::record_payment`.
 * Returns a Transaction ready to dry-run / sign / submit.
 */
export function buildMovaOwnedPaymentPtb(payload: MovaOwnedTransferPayload): Transaction {
  const packageId = requirePackageId(payload.movaPackageId);
  const tx = new Transaction();
  tx.setSender(payload.from);

  // 1) Pay — split the gas coin for the exact validated amount.
  const [coin] = tx.splitCoins(tx.gas, [BigInt(payload.amount)]);
  // 2) Pay — hand the coin to the validated recipient.
  tx.transferObjects([coin], tx.pure.address(payload.to));

  // 3) Record — mint the on-chain ownership mirror owned by the sender, in
  //    the SAME block as the transfer (atomic payment + record).
  tx.moveCall({
    target: `${packageId}::mova_owned::record_payment`,
    arguments: [
      tx.pure.string(payload.record.correlationId),
      tx.pure.string(payload.record.rawText),
      tx.pure.u64(payload.record.amountMist),
      tx.pure.string(payload.record.asset),
      tx.pure.address(payload.record.recipient),
      tx.pure.string(payload.record.network),
      tx.pure.string(payload.record.state),
      tx.pure.u64(payload.record.createdAtMs),
    ],
  });

  return tx;
}

/**
 * Build the follow-up receipt PTB (`mova_owned::mint_receipt`). Separate from
 * the payment PTB because it carries the real `txDigest` (only known after
 * submission) — minting a receipt in the same block would require faking it.
 */
export function buildMovaReceiptPtb(opts: {
  movaPackageId: string;
  from: string;
  receipt: MovaReceiptArgs;
}): Transaction {
  const packageId = requirePackageId(opts.movaPackageId);
  const tx = new Transaction();
  tx.setSender(opts.from);
  tx.moveCall({
    target: `${packageId}::mova_owned::mint_receipt`,
    arguments: [
      tx.pure.string(opts.receipt.paymentRecordId),
      tx.pure.u64(opts.receipt.amountMist),
      tx.pure.string(opts.receipt.asset),
      tx.pure.address(opts.receipt.recipient),
      tx.pure.string(opts.receipt.txDigest),
      tx.pure.bool(opts.receipt.simulated),
      tx.pure.u64(opts.receipt.issuedAtMs),
    ],
  });
  return tx;
}
