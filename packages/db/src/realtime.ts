/**
 * Realtime status push (Supabase `postgres_changes` on `payment_intents`).
 *
 * The Edge Function writes `payment_intents.status` with the service-role key;
 * the migration puts `payment_intents` on the `supabase_realtime` publication,
 * so this browser subscription receives every status transition and the UI can
 * reconcile it into the in-memory store. Returns an unsubscribe function.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.js";
import type { RealtimeStatusChange } from "./types.js";

export function subscribeToIntentStatus(
  client: SupabaseClient<Database>,
  onStatus: (change: RealtimeStatusChange) => void,
): () => void {
  const channel = client
    .channel("mova-payment-status")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "payment_intents" },
      (payload) => {
        const row = payload.new as {
          id?: string;
          correlation_id?: string;
          status?: string;
          updated_at?: string;
        } | null;
        if (!row?.id || !row.status) return;
        onStatus({
          table: "payment_intents",
          recordId: row.id,
          correlationId: row.correlation_id ?? "",
          status: row.status,
          updatedAt: row.updated_at ?? new Date().toISOString(),
        });
      },
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
