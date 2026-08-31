-- ============================================================================
-- MOVA — sync/meta additions (Phase: Supabase wiring)
--
-- Adds a denormalized `meta` JSONB snapshot to `payment_intents` so the demo
-- UI can round-trip the full in-memory `PaymentRecord` (state, amount,
-- recipient, settlement, execution …) alongside the normalized columns, and a
-- deterministic demo-owner helper the `mova-sync` Edge Function uses to satisfy
-- the `user_id` FK when there is no Supabase Auth session (the demo wallet
-- address is the ownership anchor).
--
-- Apply after 0001: supabase db push
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Denormalized record snapshot for UI round-trip (nullable — normalized
--    columns remain the source of truth; meta is a convenience projection).
-- ---------------------------------------------------------------------------
alter table public.payment_intents
  add column if not exists meta jsonb;

-- ---------------------------------------------------------------------------
-- 2. Deterministic demo-owner user (FK anchor for anonymous demo writes).
--    The Edge Function upserts/returns this row for any wallet address so the
--    `user_id` NOT NULL FK is satisfied without a Supabase Auth session.
--    Id is a stable v5-style UUID derived from the wallet address, so each
--    wallet maps to the same owner across runs.
-- ---------------------------------------------------------------------------
create or replace function public.mova_demo_user_id(p_wallet text)
returns uuid
language plpgsql
stable
as $$
declare
  h bigint := 14695981039346656037;
  c bigint;
  b bytea := convert_to(coalesce(p_wallet, 'demo'), 'UTF8');
  i int;
begin
  for i in 1 .. octet_length(b) loop
    c := get_byte(b, i - 1);
    h := (h # (c & 255));
    h := (h * 1099511628211) & 9223372036854775807;
  end loop;
  -- fold the 64-bit hash into a stable 128-bit UUID (namespace 00000000-0000-0000-0000-0000000000ff)
  return (
    lpad(to_hex(h), 16, '0') || '-' ||
    lpad(to_hex((h / 65536) & 65535), 4, '0') || '-' ||
    '4' || lpad(to_hex((h / 16) & 4095), 3, '0') || '-' ||
    '8' || lpad(to_hex(h & 4095), 3, '0') || '-' ||
    lpad(to_hex(((h * 2654435761) & 4294967295)), 12, '0')
  )::uuid;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Realtime: also stream append-only audit rows to the UI (optional; the
--    payment_intents status push is already enabled by 0001).
-- ---------------------------------------------------------------------------
-- alter publication supabase_realtime add table public.audit_events;
