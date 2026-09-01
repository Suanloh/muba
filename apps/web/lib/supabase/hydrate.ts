/**
 * Supabase history → in-memory store hydration.
 *
 * The Activity view must show EVERYTHING the DB knows — not just the records
 * produced by the current browser session. The Edge Function's
 * `GET ?kind=history` returns the raw rows (payment_intents, receipts,
 * audit_events); this module maps them back into the `PaymentRecord` /
 * `PaymentReceipt` / `AuditEvent` domain objects the store already uses.
 *
 * Payment intents store a full denormalized `meta` snapshot (see `sync.ts`)
 * so new payments round-trip losslessly. Legacy rows without `meta` (written
 * before the snapshot existed) are reconstructed from their audit events —
 * every flow emits INTENT_CREATED (raw text) + INTENT_PARSED (amount /
 * recipient / network), so even old history renders correctly.
 */
import type {
  AuditEvent,
  ExecutionFailureInfo,
  Money,
  Network,
  PaymentState,
} from "@mova/types";
import {
  createPaymentRecord,
  type PaymentReceipt,
  type PaymentRecord,
  type PaymentSettlement,
} from "@mova/wallet";
import { movaDb } from "./mova-db";

export interface HistorySnapshot {
  records: PaymentRecord[];
  receipts: PaymentReceipt[];
  audit: AuditEvent[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Coerce a DB timestamp (ISO string or epoch ms) into an epoch ms number. */
function toEpoch(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "") {
    const n = Date.parse(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

const PAYMENT_STATES = new Set<PaymentState>([
  "CREATED",
  "PARSED",
  "ROUTE_FOUND",
  "COMPLIANCE_CHECKED",
  "RISK_ASSESSED",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTING",
  "SETTLED",
  "FAILED",
]);

function isPaymentState(v: unknown): v is PaymentState {
  return typeof v === "string" && PAYMENT_STATES.has(v as PaymentState);
}

/** Rebuild the domain id (e.g. `pay_<uuid>`) from a possibly-prefixed entity id. */
function recordIdFrom(entityId: unknown, correlationId: string): string {
  const raw = asString(entityId).trim();
  if (raw.startsWith("pay_")) return raw;
  if (/^[0-9a-f-]{32,}$/i.test(raw)) return `pay_${raw}`;
  return `pay_${correlationId}`;
}

function moneyFrom(v: unknown): Money {
  if (isRecord(v) && typeof v.asset === "string" && typeof v.amount === "string") {
    return { asset: v.asset, amount: v.amount };
  }
  return { asset: "SUI", amount: "0" };
}

function recipientFrom(v: unknown): { type: "ADDRESS" | "HANDLE" | "EMAIL"; value: string; name: string | null } {
  if (isRecord(v)) {
    const type = v.type === "HANDLE" || v.type === "EMAIL" || v.type === "ADDRESS" ? v.type : "ADDRESS";
    return { type, value: asString(v.value), name: typeof v.name === "string" ? v.name : null };
  }
  return { type: "ADDRESS", value: "", name: null };
}

export function dbRowToAuditEvent(row: Record<string, unknown>): AuditEvent | null {
  const id = asString(row.id);
  const correlationId = asString(row.correlation_id);
  if (!id || !correlationId) return null;
  const actorRaw = isRecord(row.actor) ? row.actor : {};
  const actorType = actorRaw.type === "USER" || actorRaw.type === "SYSTEM" || actorRaw.type === "AI" || actorRaw.type === "APPROVER" || actorRaw.type === "EXTERNAL" ? actorRaw.type : "SYSTEM";
  return {
    id,
    correlationId,
    entityType:
      row.entity_type === "ROUTE" || row.entity_type === "COMPLIANCE" || row.entity_type === "RISK" || row.entity_type === "APPROVAL" || row.entity_type === "TRANSACTION"
        ? row.entity_type
        : "PAYMENT_INTENT",
    entityId: asString(row.entity_id),
    eventType: asString(row.event_type),
    actor: { type: actorType, id: asString(actorRaw.id) || "unknown" },
    payload: row.payload ?? {},
    previousState: row.previous_state == null ? null : asString(row.previous_state),
    newState: row.new_state == null ? null : asString(row.new_state),
    simulated: Boolean(row.simulated),
    timestamp: toEpoch(row.created_at, Date.now()),
  };
}

function recordFromMeta(meta: Record<string, unknown>, fallbackState: unknown): PaymentRecord | null {
  if (typeof meta.id !== "string" || typeof meta.correlationId !== "string") return null;
  const r = meta as unknown as PaymentRecord;
  return {
    ...r,
    createdAt: toEpoch(r.createdAt, Date.now()),
    updatedAt: toEpoch(r.updatedAt, Date.now()),
    state: isPaymentState(r.state) ? r.state : isPaymentState(fallbackState) ? fallbackState : "CREATED",
  };
}

function failureFromEvents(events: AuditEvent[]): ExecutionFailureInfo | null {
  for (const e of events) {
    if (!isRecord(e.payload) || !isRecord(e.payload.failure)) continue;
    const f = e.payload.failure;
    if (typeof f.code === "string") {
      return {
        code: f.code as ExecutionFailureInfo["code"],
        stage: typeof f.stage === "string" ? (f.stage as ExecutionFailureInfo["stage"]) : "EXECUTION",
        message: asString(f.message),
        userActionable: Boolean(f.userActionable),
        retryable: Boolean(f.retryable),
        at: toEpoch(f.at, e.timestamp),
      };
    }
  }
  return null;
}

function settlementFromEvents(events: AuditEvent[]): PaymentSettlement | null {
  const settled = events.find((e) => e.eventType === "SETTLED");
  if (!settled) return null;
  const p = isRecord(settled.payload) ? settled.payload : {};
  const simulated = p.simulated !== false;
  const txDigest = typeof p.txDigest === "string" && p.txDigest ? p.txDigest : null;
  return {
    status: simulated ? "SIMULATED" : "CONFIRMED",
    simulated,
    txDigest,
    signedBy: typeof p.signedBy === "string" ? p.signedBy : null,
    signedAt: settled.timestamp,
    error: null,
  };
}

/**
 * Reconstruct a PaymentRecord from a group of audit events (used for legacy
 * flows that have no `payment_intents` row or no `meta` snapshot).
 */
export function recordFromAuditEvents(correlationId: string, events: AuditEvent[]): PaymentRecord | null {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const created = sorted.find((e) => e.eventType === "INTENT_CREATED") ?? sorted[0];
  const parsed = sorted.find((e) => e.eventType === "INTENT_PARSED");
  if (!created && !parsed) return null;

  const id = recordIdFrom(created?.entityId ?? parsed?.entityId, correlationId);
  const rawText = isRecord(created?.payload) && typeof created.payload.rawText === "string" ? created.payload.rawText : "";
  const pp = isRecord(parsed?.payload) ? parsed.payload : {};
  const amount = moneyFrom(pp.amount);
  const recipient = recipientFrom(pp.recipient);
  const network = (typeof pp.network === "string" ? pp.network : "SUI_TESTNET") as Network;
  const memo = typeof pp.memo === "string" ? pp.memo : null;

  const ownerAddress = asString(created?.actor.id);

  // Current state = the last lifecycle state the flow reached.
  let state: PaymentState = "CREATED";
  for (const e of sorted) {
    if (isPaymentState(e.newState)) state = e.newState;
  }

  const failure = failureFromEvents(sorted);
  const settlement = settlementFromEvents(sorted);
  const createdAt = toEpoch(created?.timestamp, Date.now());
  const updatedAt = toEpoch(sorted[sorted.length - 1]?.timestamp, createdAt);

  const base = createPaymentRecord({
    id,
    correlationId,
    ownerAddress,
    rawText,
    action: pp.action === "TRANSFER" ? "TRANSFER" : "PAY",
    amount,
    recipient,
    network,
    memo,
    state: "CREATED",
    createdAt,
  });

  return {
    ...base,
    validated: Boolean(pp.validated),
    state,
    approval: null,
    authz: null,
    settlement,
    execution: failure
      ? {
          clientRequestId: `mova-${correlationId}`,
          specDigest: "",
          attempts: 1,
          lastAttemptAt: failure.at,
          executedAt: failure.at,
          failure,
          settlement: state === "FAILED" ? "FAILED" : null,
        }
      : null,
    updatedAt,
  };
}

/** Map a `payment_intents` row back into a PaymentRecord. */
export function dbRowToRecord(row: Record<string, unknown>): PaymentRecord | null {
  const meta = isRecord(row.meta) ? row.meta : null;
  if (meta) {
    const fromMeta = recordFromMeta(meta, row.status);
    if (fromMeta) return fromMeta;
  }
  // Legacy row without a meta snapshot — leave it to the audit-event
  // reconstruction path (the caller groups by correlationId).
  return null;
}

/** Map a `receipts` row back into a PaymentReceipt. */
export function dbRowToReceipt(row: Record<string, unknown>): PaymentReceipt | null {
  const recordUuid = asString(row.payment_intent_id);
  const paymentRecordId = recordUuid ? (recordUuid.startsWith("pay_") ? recordUuid : `pay_${recordUuid}`) : asString(row.correlation_id);
  if (!paymentRecordId) return null;
  return {
    id: `receipt_${paymentRecordId}`,
    paymentRecordId,
    ownerAddress: asString(row.owner_address),
    amount: {
      asset: asString(row.amount_asset),
      amount: asString(row.amount_amount),
    },
    recipient: asString(row.recipient),
    network: (asString(row.network) || "SUI_TESTNET") as Network,
    txDigest: row.tx_digest == null ? null : asString(row.tx_digest),
    simulated: Boolean(row.simulated),
    issuedAt: toEpoch(row.issued_at, Date.now()),
  };
}

/**
 * Fetch the persisted history and turn it into in-memory domain objects.
 * Offline/unconfigured data layers return an empty snapshot (never throw).
 */
export async function hydrateHistory(): Promise<HistorySnapshot> {
  const history = await movaDb.listHistory();

  const audit = history.audit
    .map((row) => dbRowToAuditEvent(row))
    .filter((e): e is AuditEvent => e !== null);

  // Group audit events by correlation so legacy flows (no intent row / no
  // meta) can be reconstructed purely from their trail.
  const byCorrelation = new Map<string, AuditEvent[]>();
  for (const e of audit) {
    const arr = byCorrelation.get(e.correlationId) ?? [];
    arr.push(e);
    byCorrelation.set(e.correlationId, arr);
  }

  const records: PaymentRecord[] = [];
  const seenRecords = new Set<string>();
  for (const row of history.intents) {
    const rec = dbRowToRecord(row);
    if (rec && !seenRecords.has(rec.id)) {
      records.push(rec);
      seenRecords.add(rec.id);
    }
    const corr = asString(row.correlation_id);
    const events = byCorrelation.get(corr);
    if (rec && events) {
      // Enrich the meta round-trip with anything derivable from the trail
      // (e.g. settlement/failure for records that were synced pre-settlement).
      const settlement = settlementFromEvents(events);
      const failure = failureFromEvents(events);
      if (settlement && !rec.settlement) rec.settlement = settlement;
      if (failure && !rec.execution?.failure) {
        rec.execution = rec.execution
          ? { ...rec.execution, failure }
          : {
              clientRequestId: `mova-${rec.correlationId}`,
              specDigest: "",
              attempts: 1,
              lastAttemptAt: failure.at,
              executedAt: failure.at,
              failure,
              settlement: rec.state === "FAILED" ? "FAILED" : null,
            };
      }
    }
  }

  // Any correlation seen only in the audit trail (no intent row) still gets a
  // record so the Activity view lists it.
  for (const [corr, events] of byCorrelation) {
    const rec = recordFromAuditEvents(corr, events);
    if (rec && !seenRecords.has(rec.id)) {
      records.push(rec);
      seenRecords.add(rec.id);
    }
  }

  const receipts = history.receipts
    .map((row) => dbRowToReceipt(row))
    .filter((r): r is PaymentReceipt => r !== null);

  records.sort((a, b) => b.createdAt - a.createdAt);

  return { records, receipts, audit };
}
