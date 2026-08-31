/**
 * MOVA `mova-sync` Edge Function — the ONLY privileged writer to Supabase.
 *
 * The web app holds only the anon key (RLS-scoped). To persist a payment
 * intent, its audit trail or a receipt it POSTs here; this function uses the
 * service-role key (server-side only, never shipped to the browser) to write,
 * satisfying the `user_id` FK via a deterministic demo-owner derived from the
 * wallet address. The migration keeps `audit_events` append-only and
 * `payment_intents.status` transitions guarded by the state machine.
 *
 * Contract:
 *   POST { kind: "intent"|"audit"|"receipt", item: {...} } -> { ok, written }
 *   GET  ?kind=audit&correlationId=<id>                     -> { items: [...] }
 *
 * Deploy: supabase functions deploy mova-sync --no-verify-jwt
 *         (no JWT required — the demo has no Auth session; RLS stays intact
 *          because writes go through the service role).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const DEMO_OWNER_FALLBACK_UUID = "00000000-0000-0000-0000-000000000001";

/** Return a deterministic user id for a wallet address (FK anchor). */
function demoUserId(walletAddress: string | null | undefined): string {
  if (!walletAddress) return DEMO_OWNER_FALLBACK_UUID;
  // Keep the function dependency-free: the SQL helper is preferred, but this
  // gives a stable id even before 0002 is applied (matching its FNV-1a).
  let h = 14695981039346656037n;
  for (const ch of `mova:${walletAddress}`) {
    h ^= BigInt(ch.codePointAt(0) ?? 0);
    h = (h * 1099511628211n) & 0x7fffffffffffffffn;
  }
  const hex = h.toString(16).padStart(16, "0");
  const lo = ((h * 2654435761n) & 0xffffffffn).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-8${hex.slice(15, 16)}-${lo.padEnd(12, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // ------------------------------------------------------------- read path
    if (req.method === "GET") {
      const kind = url.searchParams.get("kind");
      if (kind === "health") {
        return json({ ok: true, service: "mova-sync", time: new Date().toISOString() });
      }
      if (kind === "audit") {
        const correlationId = url.searchParams.get("correlationId");
        if (!correlationId) return json({ error: "correlationId required" }, 400);
        const { data, error } = await supabase
          .from("audit_events")
          .select("*")
          .eq("correlation_id", correlationId)
          .order("created_at", { ascending: true });
        if (error) return json({ error: error.message }, 500);
        return json({ items: data ?? [] });
      }
      return json({ error: `unknown kind '${kind}'` }, 400);
    }

    // ------------------------------------------------------------ write path
    if (req.method === "POST") {
      const body = await req.json();
      const kind = body?.kind as string;
      const item = body?.item as Record<string, unknown> | undefined;
      if (!item || typeof item !== "object") return json({ error: "item required" }, 400);

      if (kind === "intent") {
        const userId = demoUserId(item.walletAddress as string | null);
        const { error: userErr } = await supabase.from("users").upsert(
          {
            id: userId,
            external_id: (item.walletAddress as string) ?? "demo",
            email: `${((item.walletAddress as string) ?? "demo").slice(0, 12)}@demo.mova`,
            display_name: "MOVA demo wallet",
            role: "OWNER",
            status: "ACTIVE",
            kyc_status: "NOT_STARTED",
          },
          { onConflict: "id" },
        );
        if (userErr) return json({ error: `user upsert: ${userErr.message}` }, 500);

        const { data, error } = await supabase
          .from("payment_intents")
          .upsert(
            {
              id: item.id as string,
              correlation_id: item.correlationId as string,
              intent_ref: (item.intentRef as string) ?? `PAY-${String(item.correlationId).slice(0, 8)}`,
              user_id: userId,
              wallet_id: null,
              source: (item.source as string) ?? "CHAT",
              raw_text: (item.rawText as string) ?? "",
              network: (item.network as string) ?? "SUI_TESTNET",
              status: (item.status as string) ?? "CREATED",
              failure_code: (item.failureCode as string) ?? null,
              meta: (item.meta as Record<string, unknown>) ?? {},
              created_at: (item.createdAt as string) ?? new Date().toISOString(),
              updated_at: (item.updatedAt as string) ?? new Date().toISOString(),
            },
            { onConflict: "id" },
          );
        if (error) return json({ error: error.message }, 500);
        return json({ written: data ? 1 : 1 });
      }

      if (kind === "audit") {
        const { data, error } = await supabase.from("audit_events").insert({
          id: item.id as string,
          correlation_id: item.correlationId as string,
          entity_type: (item.entityType as string) ?? "PAYMENT_INTENT",
          entity_id: (item.entityId as string) ?? "",
          event_type: (item.eventType as string) ?? "",
          actor: { type: item.actorType ?? "SYSTEM", id: item.actorId ?? "unknown" },
          payload: (item.payload as Record<string, unknown>) ?? {},
          previous_state: (item.previousState as string) ?? null,
          new_state: (item.newState as string) ?? null,
          simulated: Boolean(item.simulated),
          created_at: (item.createdAt as string) ?? new Date().toISOString(),
        });
        if (error) return json({ error: `audit insert: ${error.message}` }, 500);
        return json({ written: data ? data.length : 1 });
      }

      if (kind === "receipt") {
        const { data, error } = await supabase.from("receipts").insert({
          id: item.id as string,
          payment_intent_id: (item.paymentIntentId as string) ?? null,
          owner_address: (item.ownerAddress as string) ?? "",
          amount_asset: (item.amountAsset as string) ?? "",
          amount_amount: (item.amountAmount as string) ?? "",
          recipient: (item.recipient as string) ?? "",
          network: (item.network as string) ?? "SUI_TESTNET",
          tx_digest: (item.txDigest as string) ?? null,
          simulated: Boolean(item.simulated),
          issued_at: (item.issuedAt as string) ?? new Date().toISOString(),
        });
        if (error) return json({ error: `receipt insert: ${error.message}` }, 500);
        return json({ written: data ? data.length : 1 });
      }

      return json({ error: `unknown kind '${kind}'` }, 400);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
