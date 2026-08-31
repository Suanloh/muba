/**
 * MOVA Edge Function client (`mova-sync`).
 *
 * The web app never holds the service-role key. Instead it POSTs sync items to
 * the Supabase Edge Function `mova-sync`, which performs the privileged write
 * with the service-role key and returns how many rows were written. Reads of
 * the append-only audit trail go through the same function (RLS allows owners
 * to read their own audit rows, but the demo has no auth user — the function
 * scopes reads by correlationId).
 *
 * `fetchImpl` is injectable so tests can run offline against a stub.
 */
import type { MovaAuditSync, MovaIntentSync, MovaReceiptSync, MovaSyncItem, SyncResult } from "./types.js";

export interface MovaEdgeClientOptions {
  /** Supabase project URL, e.g. https://abc.supabase.co. */
  url: string;
  /** Public anon key — fine in the browser (RLS-scoped). */
  anonKey?: string;
  /** Edge Function name (default "mova-sync"). */
  functionName?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

export class MovaEdgeClient {
  readonly functionName: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: MovaEdgeClientOptions) {
    this.functionName = options.functionName ?? "mova-sync";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get endpoint(): string {
    return `${this.options.url.replace(/\/$/, "")}/functions/v1/${this.functionName}`;
  }

  private async post(body: unknown): Promise<SyncResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.anonKey ? { apikey: this.options.anonKey, authorization: `Bearer ${this.options.anonKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network failure — honest, never a fabricated success.
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `mova-sync returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      };
    }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; written?: number; error?: string };
    return { ok: data.ok ?? true, written: data.written ?? 0, error: data.error };
  }

  async pushIntent(snapshot: MovaIntentSync): Promise<SyncResult> {
    return this.post({ kind: "intent", item: snapshot } satisfies { kind: "intent"; item: MovaIntentSync });
  }

  async pushAudit(event: MovaAuditSync): Promise<SyncResult> {
    return this.post({ kind: "audit", item: event } satisfies { kind: "audit"; item: MovaAuditSync });
  }

  async pushReceipt(receipt: MovaReceiptSync): Promise<SyncResult> {
    return this.post({ kind: "receipt", item: receipt } satisfies { kind: "receipt"; item: MovaReceiptSync });
  }

  /** Probe the Edge Function — true when it responds (reachable + deployed). */
  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.endpoint}?kind=health`, {
        headers: this.options.anonKey
          ? { apikey: this.options.anonKey, authorization: `Bearer ${this.options.anonKey}` }
          : {},
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Read the append-only audit trail for one correlationId. */
  async listAudit(correlationId: string): Promise<Array<Record<string, unknown>>> {
    const url = `${this.endpoint}?kind=audit&correlationId=${encodeURIComponent(correlationId)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: this.options.anonKey
          ? { apikey: this.options.anonKey, authorization: `Bearer ${this.options.anonKey}` }
          : {},
      });
    } catch {
      return [];
    }
    if (!res.ok) return [];
    const data = (await res.json().catch(() => ({ items: [] }))) as { items: Array<Record<string, unknown>> };
    return data.items ?? [];
  }
}

export function isSyncItem(item: MovaSyncItem): item is MovaSyncItem {
  return item != null && typeof item === "object";
}
