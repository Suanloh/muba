/**
 * Store → Supabase sync mappers + orchestration.
 *
 * Converts in-memory `PaymentRecord` / `AuditEvent` / `PaymentReceipt` into
 * the `@mova/db` sync envelope and pushes them through the `MovaDb` facade
 * (Edge Function → service-role write). Every push is best-effort: a failure
 * never blocks the payment flow; the Settings "Data layer" panel surfaces the
 * last sync error.
 */
import type { MovaAuditSync, MovaIntentSync, MovaReceiptSync } from "@mova/db";
import type { AuditEvent } from "@mova/types";
import type { PaymentRecord, PaymentReceipt } from "@mova/wallet";
import { movaDb } from "./mova-db";

/** Deterministic intent ref for a record — matches the DB unique constraint. */
export function intentRefFor(record: PaymentRecord): string {
  return `PAY-${record.correlationId.slice(0, 8)}-${record.id.slice(0, 4)}`;
}

export function recordToIntentSync(record: PaymentRecord): MovaIntentSync {
  const failureCode = record.execution?.failure?.code ?? null;
  return {
    id: record.id,
    correlationId: record.correlationId,
    intentRef: intentRefFor(record),
    source: "CHAT",
    rawText: record.rawText,
    network: record.network,
    status: record.state,
    failureCode,
    walletAddress: record.ownerAddress,
    meta: {
      amount: record.amount,
      recipient: record.recipient,
      action: record.action,
      memo: record.memo,
      validated: record.validated,
      approval: record.approval,
      settlement: record.settlement,
      execution: record.execution,
    },
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
}

export function auditEventToSync(event: AuditEvent): MovaAuditSync {
  return {
    id: event.id,
    correlationId: event.correlationId,
    entityType: event.entityType,
    entityId: event.entityId,
    eventType: event.eventType,
    actorType: event.actor.type,
    actorId: event.actor.id,
    payload: event.payload as Record<string, unknown>,
    previousState: event.previousState,
    newState: event.newState,
    simulated: event.simulated,
    createdAt: new Date(event.timestamp).toISOString(),
  };
}

export function receiptToSync(receipt: PaymentReceipt): MovaReceiptSync {
  return {
    id: receipt.id,
    correlationId: receipt.paymentRecordId,
    ownerAddress: receipt.ownerAddress,
    amountAsset: receipt.amount.asset,
    amountAmount: receipt.amount.amount,
    recipient: receipt.recipient,
    network: receipt.network,
    txDigest: receipt.txDigest,
    simulated: receipt.simulated,
    issuedAt: new Date(receipt.issuedAt).toISOString(),
  };
}

/** Best-effort sync of one record (intent) — never throws. */
export async function syncRecordBestEffort(record: PaymentRecord) {
  try {
    return await movaDb.syncIntent(recordToIntentSync(record));
  } catch {
    return { ok: false as const, error: "sync failed" };
  }
}

/** Best-effort sync of one audit event — never throws. */
export async function syncAuditBestEffort(event: AuditEvent) {
  try {
    return await movaDb.syncAudit(auditEventToSync(event));
  } catch {
    return { ok: false as const, error: "sync failed" };
  }
}

/** Best-effort sync of one receipt — never throws. */
export async function syncReceiptBestEffort(receipt: PaymentReceipt) {
  try {
    return await movaDb.syncReceipt(receiptToSync(receipt));
  } catch {
    return { ok: false as const, error: "sync failed" };
  }
}
