/**
 * `MovaDb` — the unified Supabase data-access facade the rest of MOVA uses.
 *
 * One interface, two honest modes:
 *   - **online**: writes go through the `mova-sync` Edge Function (service-role
 *     key server-side), reads + Realtime via the RLS-scoped anon client.
 *   - **offline**: in-memory only, every sync reports `offline: true` with the
 *     reason. Never blocks the payment flow.
 *
 * The web app builds this once (see apps/web/lib/supabase/mova-db.ts) and
 * passes it to the app-store, which syncs records/audit best-effort.
 */
import { createMovaBrowserClient, isSupabaseConfigured } from "./client.js";
import { MovaEdgeClient } from "./edge.js";
import { OfflineMovaDb } from "./offline.js";
import { subscribeToIntentStatus } from "./realtime.js";
import type {
  MovaAuditSync,
  MovaHistory,
  MovaIntentSync,
  MovaReceiptSync,
  RealtimeStatusChange,
  SyncResult,
} from "./types.js";

export interface MovaDbOptions {
  url?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  functionName?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

export type MovaDbStatus = "online" | "offline";

export interface MovaDb {
  readonly status: MovaDbStatus;
  readonly reason: string | null;
  syncIntent(snapshot: MovaIntentSync): Promise<SyncResult>;
  syncAudit(event: MovaAuditSync): Promise<SyncResult>;
  syncReceipt(receipt: MovaReceiptSync): Promise<SyncResult>;
  listAudit(correlationId: string): Promise<Array<Record<string, unknown>>>;
  /** Read the full persisted history (intents + receipts + audit). */
  listHistory(): Promise<MovaHistory>;
  /** Probe the Edge Function — true when reachable + deployed. */
  ping(): Promise<boolean>;
  subscribeToStatus(onStatus: (change: RealtimeStatusChange) => void): () => void;
}

const OFFLINE_REASON =
  "Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (apps/web/.env.local) to persist records and audit to Supabase.";

export function createMovaDb(options: MovaDbOptions = {}): MovaDb {
  const configured = isSupabaseConfigured({
    url: options.url,
    anonKey: options.anonKey,
    serviceRoleKey: options.serviceRoleKey,
  });

  if (!configured) {
    return new OfflineMovaDb(OFFLINE_REASON);
  }

  const url = (options.url ?? "").replace(/\/$/, "");
  const anonKey = options.anonKey ?? "";
  const edge = new MovaEdgeClient({
    url,
    anonKey,
    functionName: options.functionName,
    fetchImpl: options.fetchImpl,
  });

  return {
    status: "online",
    reason: null,

    async syncIntent(snapshot: MovaIntentSync): Promise<SyncResult> {
      try {
        return await edge.pushIntent(snapshot);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async syncAudit(event: MovaAuditSync): Promise<SyncResult> {
      try {
        return await edge.pushAudit(event);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async syncReceipt(receipt: MovaReceiptSync): Promise<SyncResult> {
      try {
        return await edge.pushReceipt(receipt);
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async listAudit(correlationId: string): Promise<Array<Record<string, unknown>>> {
      try {
        return await edge.listAudit(correlationId);
      } catch {
        return [];
      }
    },

    async listHistory(): Promise<MovaHistory> {
      try {
        return await edge.listHistory();
      } catch {
        return { intents: [], receipts: [], audit: [] };
      }
    },

    async ping(): Promise<boolean> {
      return edge.ping();
    },

    subscribeToStatus(onStatus: (change: RealtimeStatusChange) => void): () => void {
      // Realtime needs a live client + network; if that fails we report
      // nothing rather than crash — the unsubscribe still works.
      try {
        const client = createMovaBrowserClient(url, anonKey);
        return subscribeToIntentStatus(client, onStatus);
      } catch {
        return () => {};
      }
    },
  };
}
