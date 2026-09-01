/**
 * Honest offline fallback for `@mova/db`.
 *
 * When Supabase is not configured (no URL / no key) the app still works —
 * records and audit stay in-memory, and every sync attempt returns
 * `{ ok: false, offline: true }` with a clear reason. The UI surfaces this so
 * "offline (in-memory)" is never confused with "persisted to Supabase".
 * Realtime subscription is a no-op that reports no changes.
 */
import type { MovaAuditSync, MovaHistory, MovaIntentSync, MovaReceiptSync, RealtimeStatusChange, SyncResult } from "./types.js";

export class OfflineMovaDb {
  readonly status = "offline" as const;

  constructor(readonly reason: string) {}

  async syncIntent(_snapshot: MovaIntentSync): Promise<SyncResult> {
    return { ok: false, offline: true, error: this.reason };
  }

  async syncAudit(_event: MovaAuditSync): Promise<SyncResult> {
    return { ok: false, offline: true, error: this.reason };
  }

  async syncReceipt(_receipt: MovaReceiptSync): Promise<SyncResult> {
    return { ok: false, offline: true, error: this.reason };
  }

  async listAudit(_correlationId: string): Promise<Array<Record<string, unknown>>> {
    return [];
  }

  async listHistory(): Promise<MovaHistory> {
    return { intents: [], receipts: [], audit: [] };
  }

  async ping(): Promise<boolean> {
    return false;
  }

  subscribeToStatus(_onStatus: (change: RealtimeStatusChange) => void): () => void {
    return () => {};
  }
}
