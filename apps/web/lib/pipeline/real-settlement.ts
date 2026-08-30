/**
 * Real settlement wiring for the web app (Phase 2).
 *
 * Builds a real native-SUI transfer PTB from a validated, approved payment
 * record and submits it through the connected wallet. The wallet user signs
 * the transaction (the browser gate has already passed); the app records a
 * REAL testnet digest with `simulated: false`.
 *
 * Safety: this builds a PTB only from EXPLICIT, validated record params
 * (amount + recipient), and only after the `WalletExecutionGate` passes. The
 * AI never contributes to the transaction. If the wallet can't fund/submit
 * (e.g. no testnet gas), the caller falls back to simulated and records the
 * reason.
 */
import { Transaction } from "@mysten/sui/transactions";
import { buildMovaOwnedPaymentPtb } from "@mova/integrations";
import type { PaymentRecord } from "@mova/wallet";
import { MOVA_PACKAGE_ID } from "@/lib/wallet/networks";

/** Build a native-SUI transfer PTB from a validated, approved record. */
export function buildTransferTransaction(record: PaymentRecord, sender: string): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  const amount = BigInt(record.amount.amount);
  const [coin] = tx.splitCoins(tx.gas, [amount]);
  tx.transferObjects([coin], tx.pure.address(record.recipient.value));
  return tx;
}

/**
 * Build the MOVA-OWNED PTB from a validated, approved record: ONE programmable
 * transaction block that transfers the SUI AND mints the on-chain
 * `OwnedPaymentRecord` (mova_owned::record_payment) owned by the sender —
 * atomically, in a single user-signed transaction.
 *
 * Used in real settlement mode when a MOVA package id resolves; falls back to
 * the plain transfer PTB otherwise.
 */
export function buildMovaOwnedTransaction(
  record: PaymentRecord,
  sender: string,
  packageId: string = MOVA_PACKAGE_ID,
): Transaction {
  return buildMovaOwnedPaymentPtb({
    kind: "MOVA_OWNED_TRANSFER",
    from: sender,
    to: record.recipient.value,
    amount: record.amount.amount,
    asset: record.amount.asset,
    movaPackageId: packageId,
    record: {
      correlationId: record.correlationId,
      rawText: record.rawText,
      amountMist: record.amount.amount,
      asset: record.amount.asset,
      recipient: record.recipient.value,
      network: record.network,
      state: "SETTLED",
      createdAtMs: record.createdAt,
    },
  });
}

