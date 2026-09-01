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
  h numeric := 14695981039346656037;   -- FNV-1a 64 offset basis (fits numeric)
  b bytea := convert_to('mova:' || coalesce(p_wallet, ''), 'UTF8');
  i int;
  hi numeric;
  lo numeric;
  digits text;
begin
  -- FNV-1a 64-bit, kept in numeric so the 2^64 wrap never overflows bigint
  -- (the 0002 original used bigint and failed to apply). Bit-identical to the
  -- edge function's demoUserId. XOR only touches the low byte here.
  for i in 1 .. octet_length(b) loop
    h := (h - mod(h, 256)) + ((mod(h, 256)::int # get_byte(b, i - 1))::numeric);
    h := mod(h * 1099511628211, 18446744073709551616);
  end loop;
  hi := h;
  lo := mod(h * 2654435761, 18446744073709551616);
  digits :=
    lpad(to_hex(floor(hi / 4294967296)::bigint), 8, '0') ||
    lpad(to_hex(mod(hi, 4294967296)::bigint), 8, '0') ||
    lpad(to_hex(floor(lo / 4294967296)::bigint), 8, '0') ||
    lpad(to_hex(mod(lo, 4294967296)::bigint), 8, '0');
  -- Format the 32 hex chars as a valid uuid (version 4 / variant 8).
  return (
    substr(digits, 1, 8) || '-' ||
    substr(digits, 9, 4) || '-' ||
    '4' || substr(digits, 13, 3) || '-' ||
    '8' || substr(digits, 16, 3) || '-' ||
    substr(digits, 19, 12)
  )::uuid;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Realtime: also stream append-only audit rows to the UI (optional; the
--    payment_intents status push is already enabled by 0001).
-- ---------------------------------------------------------------------------
-- alter publication supabase_realtime add table public.audit_events;
