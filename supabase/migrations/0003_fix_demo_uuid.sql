-- ============================================================================
-- MOVA — fix demo-owner UUID + demo write path (apply: supabase db push)
--
-- The demo data layer could never persist intents/receipts because:
--   1. `mova_demo_user_id()` (0002) and the edge fn's `demoUserId()` emitted
--      a MALFORMED uuid (4th group was 2 hex chars, e.g. `…-46f2-83-…`) and
--      0002's bigint FNV state overflowed → every demo-owner upsert failed
--      with "invalid input syntax for type uuid".
--   2. `public.users.id` referenced `auth.users(id)` — with no Auth session
--      (the demo has none) the fabricated demo-owner id could never satisfy
--      the FK even once the uuid was valid.
--
-- This migration is idempotent: it replaces the function, guarantees the
-- optional `meta` column, and drops the auth.users FK on `users`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Correct, stable deterministic demo-owner UUID (FNV-1a 64-bit → uuid
--    v4-style). Bit-identical to the edge function's `demoUserId`, so the
--    same wallet always maps to the same owner id. Numeric arithmetic avoids
--    the bigint overflow in the 0002 version.
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
  -- FNV-1a 64-bit, kept in numeric so the 2^64 wrap never overflows bigint.
  -- XOR only touches the low byte here.
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
-- 2. Optional denormalized snapshot (from 0002) — ensure it exists even if
--    0002 never applied (it previously failed on the bigint overflow).
-- ---------------------------------------------------------------------------
alter table public.payment_intents
  add column if not exists meta jsonb;

-- ---------------------------------------------------------------------------
-- 3. Demo owner persistence: the demo has no Supabase Auth session, so a
--    fabricated demo-owner id must not be blocked by the auth.users FK.
--    `users.id` stays a primary key (wallets/payment_intents/approvals still
--    FK to it); only the linkage to `auth.users` is removed. Re-add it later
--    if real Auth onboarding is introduced.
-- ---------------------------------------------------------------------------
alter table public.users
  drop constraint if exists users_id_fkey;
