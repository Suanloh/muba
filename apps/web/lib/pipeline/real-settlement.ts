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
import type { PaymentRecord } from "@mova/wallet";

/** Build a native-SUI transfer PTB from a validated, approved record. */
export function buildTransferTransaction(record: PaymentRecord, sender: string): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  const amount = BigInt(record.amount.amount);
  const [coin] = tx.splitCoins(tx.gas, [amount]);
  tx.transferObjects([coin], tx.pure.address(record.recipient.value));
  return tx;
}

