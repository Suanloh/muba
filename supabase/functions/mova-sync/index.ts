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
  // Deterministic FNV-1a 64-bit over `mova:<wallet>` → two 64-bit lanes →
  // uuid v4-style. Bit-identical to the SQL helper `mova_demo_user_id`
  // (migrations 0002/0003). The previous version emitted a malformed 2-char
  // 4th group (`…-46f2-83-…`) → "invalid input syntax for type uuid".
  let h = 14695981039346656037n;
  const bytes = new TextEncoder().encode(`mova:${walletAddress}`);
  for (const byte of bytes) {
    h ^= BigInt(byte);
    h = (h * 1099511628211n) & 0xffffffffffffffffn;
  }
  const hi = h;
  const lo = (h * 2654435761n) & 0xffffffffffffffffn;
  const digits = `${hi.toString(16).padStart(16, "0")}${lo.toString(16).padStart(16, "0")}`;
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4${digits.slice(12, 15)}-8${digits.slice(15, 18)}-${digits.slice(18, 30)}`;
}

/**
 * Extract the bare UUID from a possibly-prefixed domain id
 * (`pay_<uuid>`, `receipt_pay_<uuid>`, …). The schema's id / FK columns are
 * `uuid`, so any prefix must be stripped before insert. Returns `null` when
 * no UUID is present (the caller then decides how to handle it).
 */
function uuidOf(value: unknown): string | null {
  const m = String(value ?? "").match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return m ? m[0] : null;
}

/**
 * Upsert the deterministic demo-owner user row for a wallet address — the FK
 * anchor that satisfies `user_id NOT NULL` when there is no Auth session.
 */
async function ensureDemoUser(
  supabase: ReturnType<typeof createClient>,
  walletAddress: string | null,
): Promise<{ userId: string; error: { message?: string } | null }> {
  const userId = demoUserId(walletAddress);
  const { error } = await supabase.from("users").upsert(
    {
      id: userId,
      external_id: walletAddress ?? "demo",
      email: `${(walletAddress ?? "demo").slice(0, 12)}@demo.mova`,
      display_name: "MOVA demo wallet",
      role: "OWNER",
      status: "ACTIVE",
      kyc_status: "NOT_STARTED",
    },
    { onConflict: "id" },
  );
  return { userId, error: (error as { message?: string } | null) ?? null };
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
        const { userId, error: userErr } = await ensureDemoUser(
          supabase,
          item.walletAddress as string | null,
        );
        if (userErr) return json({ error: `user upsert: ${userErr.message}` }, 500);

        const intentRow: Record<string, unknown> = {
          id: uuidOf(item.id) ?? (item.id as string),
          correlation_id: item.correlationId as string,
          intent_ref: (item.intentRef as string) ?? `PAY-${String(item.correlationId).slice(0, 8)}`,
          user_id: userId,
          wallet_id: null,
          source: (item.source as string) ?? "CHAT",
          raw_text: (item.rawText as string) ?? "",
          network: (item.network as string) ?? "SUI_TESTNET",
          status: (item.status as string) ?? "CREATED",
          failure_code: (item.failureCode as string) ?? null,
          created_at: (item.createdAt as string) ?? new Date().toISOString(),
          updated_at: (item.updatedAt as string) ?? new Date().toISOString(),
        };
        // `meta` is an optional denormalized snapshot (migration 0002) — only
        // send it when provided, so intent sync works with 0001 applied alone.
        if (item.meta !== undefined && item.meta !== null) {
          intentRow.meta = item.meta as Record<string, unknown>;
        }
        const { data, error } = await supabase
          .from("payment_intents")
          .upsert(intentRow, { onConflict: "id" });
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
        // The receipts.payment_intent_id FK requires a parent payment_intents
        // row. The normal intent sync usually creates it first; when it has
        // not (legacy records, transient intent failures, ordering), backfill
        // a minimal SETTLED parent so the receipt is never blocked. The
        // `intents_state_guard` trigger only fires on UPDATE, and
        // ignoreDuplicates keeps an existing richer intent untouched.
        const parentId = uuidOf(item.paymentIntentId);
        if (parentId) {
          const { userId, error: userErr } = await ensureDemoUser(
            supabase,
            item.ownerAddress as string | null,
          );
          if (userErr) return json({ error: `user upsert: ${userErr.message}` }, 500);
          const parentRow: Record<string, unknown> = {
            id: parentId,
            correlation_id: uuidOf(item.correlationId) ?? parentId,
            intent_ref: `RC-${parentId.slice(0, 12)}`,
            user_id: userId,
            wallet_id: null,
            source: "CHAT",
            raw_text: "Receipt backfill (issued after SETTLED)",
            network: (item.network as string) ?? "SUI_TESTNET",
            status: "SETTLED",
            failure_code: null,
            created_at: (item.issuedAt as string) ?? new Date().toISOString(),
            updated_at: (item.issuedAt as string) ?? new Date().toISOString(),
          };
          const { error: parentErr } = await supabase
            .from("payment_intents")
            .upsert(parentRow, { onConflict: "id", ignoreDuplicates: true });
          if (parentErr) {
            return json({ error: `receipt parent upsert: ${parentErr.message}` }, 500);
          }
        }

        const { data, error } = await supabase.from("receipts").insert({
          id: uuidOf(item.id) ?? (item.id as string),
          payment_intent_id: parentId,
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
