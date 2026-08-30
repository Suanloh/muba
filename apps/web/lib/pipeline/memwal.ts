/**
 * MOVA MemWal web wiring — snapshots each settled payment's memory (audit
 * trail + settlement facts) to Walrus, Sui's decentralized blob storage.
 *
 * - Default: STATIC/demo memory store (deterministic simulated blobId).
 * - Real: set NEXT_PUBLIC_WALRUS_ENABLED=true (optionally
 *   NEXT_PUBLIC_WALRUS_PUBLISHER_URL) to store on Walrus testnet; on failure
 *   the store honestly falls back to static with the reason recorded.
 */
import { MemWalMemoryStore, type MemWalStoreResult, type MemoryRecordInput } from "@mova/integrations";
import type { PaymentRecord } from "@mova/wallet";
import type { PaymentPlan } from "./execution-engine";

/** Walrus enabled via env (real testnet storage; else static demo store). */
export const WALRUS_ENABLED =
  process.env.NEXT_PUBLIC_WALRUS_ENABLED === "true" ||
  Boolean(process.env.NEXT_PUBLIC_WALRUS_PUBLISHER_URL);

const memWalStore = new MemWalMemoryStore({
  useReal: WALRUS_ENABLED,
  publisherUrl: process.env.NEXT_PUBLIC_WALRUS_PUBLISHER_URL ?? undefined,
});

export { memWalStore };

/** Build the MemWal memory snapshot input for a settled record + plan. */
export function buildMemWalInput(opts: {
  record: PaymentRecord;
  plan: PaymentPlan;
  trail?: unknown;
}): MemoryRecordInput {
  const { record, plan, trail } = opts;
  return {
    recordId: record.id,
    correlationId: record.correlationId,
    ownerAddress: record.ownerAddress,
    amount: plan.spec.amount.amount,
    asset: plan.spec.amount.asset,
    recipient: plan.spec.recipient,
    network: record.network,
    state: record.state,
    planDigest: plan.spec.planDigest,
    txDigest: record.settlement?.txDigest ?? null,
    simulated: record.settlement?.simulated ?? true,
    createdAt: record.createdAt,
    updatedAt: Date.now(),
    trail,
  };
}

/** Result of a MemWal store for one record (for the UI + audit trail). */
export type { MemWalStoreResult };
