/**
 * MOVA → Supabase sync envelope types.
 *
 * These are the wire contracts the web app sends to the `mova-sync` Edge
 * Function (which writes with the service-role key) and the shape of a status
 * change pushed back over Realtime. They deliberately mirror
 * `@mova/types`/`@mova/wallet` records WITHOUT importing them so this package
 * stays dependency-light and the Edge Function can decode the envelope.
 */

export type MovaSyncKind = "intent" | "audit" | "receipt";

export interface MovaIntentSync {
  id: string;
  correlationId: string;
  intentRef: string;
  source: "CHAT" | "QR" | "API" | "MANUAL";
  rawText: string;
  network: string;
  status: string;
  failureCode: string | null;
  walletAddress: string | null;
  /** Optional denormalized record snapshot (stored only when provided). */
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MovaAuditSync {
  id: string;
  correlationId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  actorType: string;
  actorId: string;
  payload: Record<string, unknown>;
  previousState: string | null;
  newState: string | null;
  simulated: boolean;
  createdAt: string;
}

export interface MovaReceiptSync {
  id: string;
  /** Payment record this receipt settles — maps to receipts.payment_intent_id (uuid FK). */
  paymentIntentId?: string | null;
  correlationId: string;
  ownerAddress: string;
  amountAsset: string;
  amountAmount: string;
  recipient: string;
  network: string;
  txDigest: string | null;
  simulated: boolean;
  issuedAt: string;
}

export type MovaSyncItem = MovaIntentSync | MovaAuditSync | MovaReceiptSync;

/**
 * Full persisted history returned by the Edge Function's read path
 * (`GET ?kind=history`). Raw Supabase rows — the web layer maps them back into
 * `PaymentRecord` / `PaymentReceipt` / `AuditEvent` domain objects.
 */
export interface MovaHistory {
  intents: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
}

/** Result of one sync attempt — honest about offline/errors. */
export interface SyncResult {
  ok: boolean;
  offline?: boolean;
  error?: string;
  /** Number of rows actually written by the Edge Function. */
  written?: number;
}

/** A status change pushed over Realtime (`postgres_changes` UPDATE). */
export interface RealtimeStatusChange {
  table: string;
  recordId: string;
  correlationId: string;
  status: string;
  updatedAt: string;
}
