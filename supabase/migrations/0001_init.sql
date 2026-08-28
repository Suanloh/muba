-- ============================================================================
-- MOVA — initial Supabase schema (Phase 1)
--
-- Mirrors `packages/types/src/domain.ts` (single source of truth).
-- Rules enforced here:
--   * Money is a { asset, amount } pair where `amount` is a decimal STRING in
--     smallest units (BigInt-safe). Never floats. (amount_text)
--   * `payment_intents.status` is the lifecycle source of truth; every change
--     is written ONLY through the state machine and audited (trigger below).
--   * `audit_events` is APPEND-ONLY — UPDATE/DELETE raise unless the
--     `app.allow_audit_mutation` session flag is set (retention jobs only).
--   * RLS is the enforcement layer for OWNER / APPROVER / AUDITOR / OPERATOR.
--
-- Apply: supabase db push   (or run in the Supabase SQL editor)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. Enums (closed sets from packages/types/src/enums.ts)
-- ---------------------------------------------------------------------------
create type user_role          as enum ('OWNER','APPROVER','OPERATOR','AUDITOR','ADMIN');
create type user_status        as enum ('PENDING_KYC','ACTIVE','SUSPENDED','CLOSED');
create type kyc_status         as enum ('NOT_STARTED','PENDING','VERIFIED','REJECTED');
create type wallet_type        as enum ('OPERATING','CUSTODY','RESERVE','VAULT');
create type wallet_status      as enum ('ACTIVE','FROZEN','CLOSED');
create type network            as enum ('SUI_DEVNET','SUI_TESTNET','SUI_MAINNET');
create type intent_source      as enum ('CHAT','API','MANUAL','QR');
create type intent_action      as enum ('PAY','TRANSFER','BATCH_PAY');
create type recipient_type     as enum ('ADDRESS','HANDLE','EMAIL');
create type parsed_intent_status as enum ('PENDING','VALIDATED','INVALID','NEEDS_CLARIFICATION');
create type route_status       as enum ('CANDIDATE','SELECTED','REJECTED');
create type selection_criterion as enum ('COST','SPEED','RELIABILITY');
create type route_leg_kind     as enum ('CONVERSION','OFFCHAIN','ONCHAIN','SETTLEMENT');
create type compliance_decision as enum ('ALLOW','REVIEW','BLOCK');
create type screening_decision as enum ('CLEAR','HIT','REVIEW');
create type risk_band          as enum ('LOW','MEDIUM','HIGH','CRITICAL');
create type risk_decision      as enum ('PROCEED','REVIEW','BLOCK');
create type hedging_strategy   as enum ('NONE','PUT_OPTION','COVERED_CALL','FIXED_YIELD');
create type hedge_decision     as enum ('HEDGE','NO_HEDGE');
create type hedge_data_source  as enum ('LIVE','STATIC_DEV','UNAVAILABLE');
create type approval_level     as enum ('SINGLE','DUAL','THRESHOLD');
create type approval_status    as enum ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED');
create type approval_decision  as enum ('APPROVE','REJECT','ABSTAIN');
create type transaction_type   as enum ('NATIVE_TRANSFER','TOKEN_TRANSFER','PTB_BATCH');
create type transaction_status as enum ('PENDING','SIMULATED','SUBMITTED','CONFIRMED','REVERTED','FAILED','CANCELLED');
create type payment_state      as enum ('CREATED','PARSED','ROUTE_FOUND','COMPLIANCE_CHECKED','RISK_ASSESSED','AWAITING_APPROVAL','APPROVED','EXECUTING','SETTLED','FAILED');
create type payment_failure_code as enum (
  'VALIDATION_FAILED','ROUTING_FAILED','COMPLIANCE_BLOCKED','RISK_BLOCKED',
  'APPROVAL_REJECTED','APPROVAL_EXPIRED','CANCELLED',
  'EXECUTION_SIMULATION_FAILED','EXECUTION_FAILED','INTERNAL_ERROR'
);
create type actor_type         as enum ('USER','SYSTEM','AI','APPROVER','EXTERNAL');
create type audit_entity_type  as enum ('PAYMENT_INTENT','ROUTE','COMPLIANCE','RISK','APPROVAL','TRANSACTION');

-- ---------------------------------------------------------------------------
-- 2. Tables (dependency order)
-- ---------------------------------------------------------------------------

-- Users map 1:1 onto Supabase Auth identities.
create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  external_id  text not null unique,          -- auth-provider subject id
  email        text not null,
  display_name text,
  role         user_role not null default 'OWNER',
  status       user_status not null default 'PENDING_KYC',
  kyc_status   kyc_status not null default 'NOT_STARTED',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A wallet the user owns (Sui address is the ownership anchor).
create table public.wallets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  type             wallet_type not null default 'OPERATING',
  network          network not null,
  address          text not null,             -- Sui address (0x…)
  label            text,
  status           wallet_status not null default 'ACTIVE',
  available_balance_asset text,
  available_balance_amount text,              -- deterministic ledger snapshot (smallest units)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, address)
);

-- The user's payment request. `status` is the state-machine source of truth.
create table public.payment_intents (
  id             uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,               -- threads the whole flow
  intent_ref     text not null unique,        -- e.g. PAY-2026-0001
  user_id        uuid not null references public.users (id) on delete cascade,
  wallet_id      uuid references public.wallets (id) on delete set null,
  source         intent_source not null,
  raw_text       text not null,               -- verbatim request (auditability)
  network        network not null,
  status         payment_state not null default 'CREATED',
  failure_code   payment_failure_code,        -- set only when status = FAILED
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Validated AI parse (deterministic validator output is authoritative).
create table public.parsed_intents (
  id                        uuid primary key default gen_random_uuid(),
  payment_intent_id         uuid not null unique references public.payment_intents (id) on delete cascade,
  action                    intent_action not null,
  amount_asset              text not null,
  amount_amount             text not null,    -- smallest units, decimal string
  recipient_type            recipient_type not null,
  recipient_value           text not null,
  recipient_name            text,
  network                   network not null,
  schedule_at               timestamptz,
  memo                      text,
  confidence                numeric(4,3) check (confidence between 0 and 1),
  needs_clarification       boolean not null default false,
  clarification_question    text,
  raw_llm_output            jsonb,            -- retained for audit
  validation_status         parsed_intent_status not null,
  validator_notes           jsonb not null default '[]'::jsonb,
  canonical_amount_asset    text not null,    -- re-computed by validator
  canonical_amount_amount   text not null,
  created_at                timestamptz not null default now()
);

-- Local EMVCo QR decode (deterministic, trusted input).
create table public.qr_decoded (
  id               uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null unique references public.payment_intents (id) on delete cascade,
  payload_format   text,
  merchant_name    text,
  merchant_city    text,
  merchant_account text,
  category_code    text,
  currency_code    text,
  amount_raw       text,
  amount_asset     text,
  amount_amount    text,
  country_code     text,
  reference        text,
  bill_number      text,
  crc_valid        boolean not null,
  raw              text not null,             -- scanned payload for audit
  parse_errors     jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

-- Routing candidates + the selected route (nested leg/cost/risk as JSONB).
create table public.routes (
  id                        uuid primary key default gen_random_uuid(),
  payment_intent_id         uuid not null references public.payment_intents (id) on delete cascade,
  route_no                  integer not null,
  summary                   jsonb not null,   -- RouteSummary
  legs                      jsonb not null,   -- RouteLeg[]
  cost                      jsonb not null,   -- RouteCostBreakdown (quoteAsset)
  total_fee_asset           text not null,
  total_fee_amount          text not null,
  total_estimated_cost_asset text not null,
  total_estimated_cost_amount text not null,
  estimated_time_ms         bigint,
  reliability               numeric(6,5) check (reliability between 0 and 1),
  liquidity                 numeric(6,5) check (liquidity between 0 and 1),
  risk                      jsonb,            -- RouteRisk { score, factors[] }
  status                    route_status not null default 'CANDIDATE',
  selection_score           numeric(8,6) check (selection_score between 0 and 1),
  selection_reason          text,             -- the exact scoring math
  factor_scores             jsonb,            -- RouteFactorScores
  created_at                timestamptz not null default now()
);

create table public.compliance_assessments (
  id                uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id) on delete cascade,
  route_id          uuid references public.routes (id) on delete cascade,
  screening         jsonb,                    -- ScreeningResult
  monitoring_signals jsonb not null default '[]'::jsonb,
  risk_score        integer not null check (risk_score between 0 and 100),
  policy_results    jsonb not null default '[]'::jsonb,
  travel_rule       jsonb,
  decision          compliance_decision not null,
  fail_closed       boolean not null default false,
  engine_version    text not null,
  explanation       text,
  created_at        timestamptz not null default now()
);

create table public.risk_assessments (
  id                uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id) on delete cascade,
  route_id          uuid references public.routes (id) on delete cascade,
  band              risk_band not null,
  score             integer not null check (score between 0 and 100),
  signals           jsonb not null default '[]'::jsonb,   -- RiskSignal[]
  hedging           jsonb,                                 -- HedgingPlan
  decision          risk_decision not null,
  engine_version    text not null,
  explanation       text,
  created_at        timestamptz not null default now()
);

create table public.approval_requests (
  id                  uuid primary key default gen_random_uuid(),
  payment_intent_id   uuid not null references public.payment_intents (id) on delete cascade,
  level               approval_level not null default 'SINGLE',
  required_approver_ids jsonb not null default '[]'::jsonb,
  status              approval_status not null default 'PENDING',
  threshold_met       boolean not null default false,
  reason              text,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz,
  resolved_at         timestamptz
);

create table public.approvals (
  id                   uuid primary key default gen_random_uuid(),
  approval_request_id  uuid not null references public.approval_requests (id) on delete cascade,
  approver_id          uuid not null references public.users (id) on delete cascade,
  decision             approval_decision not null,
  note                 text,
  method               text not null default 'UI',
  signed_at            timestamptz not null default now()
);

create table public.settlement_transactions (
  id                uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id) on delete cascade,
  approval_id       uuid references public.approval_requests (id) on delete set null,
  type              transaction_type not null,
  network           network not null,
  payload           jsonb not null,           -- explicit validated params, never LLM output
  simulation        jsonb,                    -- SimulationResult
  status            transaction_status not null default 'PENDING',
  tx_digest         text,                     -- real Sui digest; NULL when simulated (never fabricated)
  simulated         boolean not null default true,
  error             text,
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz
);

-- Receipts issued after SETTLED (mirrors @mova/wallet PaymentReceipt).
create table public.receipts (
  id                uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references public.payment_intents (id) on delete cascade,
  owner_address     text not null,
  amount_asset      text not null,
  amount_amount     text not null,
  recipient         text not null,
  network           network not null,
  tx_digest         text,
  simulated         boolean not null default true,
  issued_at         timestamptz not null default now()
);

-- Append-only audit trail (Phase 8 trust layer reads this).
create table public.audit_events (
  id             uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  entity_type    audit_entity_type not null,
  entity_id      text not null,
  event_type     text not null,               -- INTENT_CREATED, SETTLED, …
  actor          jsonb not null,              -- { type: actor_type, id }
  payload        jsonb not null default '{}'::jsonb,   -- full decision context
  previous_state text,
  new_state      text,
  simulated      boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4a. State-machine guard (state-machine.md) — only LEGAL transitions may
--     change payment_intents.status; FAILED requires a failure_code; terminal
--     states (SETTLED/FAILED) never move. RLS/API can't bypass this.
-- ---------------------------------------------------------------------------
create or replace function public.validate_payment_transition()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new; -- non-transition updates (e.g. updated_at) allowed
  end if;
  if not (
    (old.status = 'CREATED'              and new.status in ('PARSED','FAILED')) or
    (old.status = 'PARSED'               and new.status in ('ROUTE_FOUND','FAILED')) or
    (old.status = 'ROUTE_FOUND'          and new.status in ('COMPLIANCE_CHECKED','FAILED')) or
    (old.status = 'COMPLIANCE_CHECKED'   and new.status in ('RISK_ASSESSED','FAILED')) or
    (old.status = 'RISK_ASSESSED'        and new.status in ('AWAITING_APPROVAL','FAILED')) or
    (old.status = 'AWAITING_APPROVAL'    and new.status in ('APPROVED','FAILED')) or
    (old.status = 'APPROVED'             and new.status in ('EXECUTING','FAILED')) or
    (old.status = 'EXECUTING'            and new.status in ('SETTLED','FAILED'))
  ) then
    raise exception 'illegal payment state transition % -> %', old.status, new.status;
  end if;
  if new.status = 'FAILED' and new.failure_code is null then
    raise exception 'FAILED requires a failure_code';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4b. Audit on state transition (state-machine rule #2: every change audited).
--     SECURITY DEFINER so the audit write can never fail/be skipped due to RLS
--     — an auditable status change must always be recorded.
-- ---------------------------------------------------------------------------
create or replace function public.record_status_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_events (
      correlation_id, entity_type, entity_id, event_type,
      actor, payload, previous_state, new_state, simulated
    ) values (
      new.correlation_id,
      'PAYMENT_INTENT',
      new.id::text,
      'STATUS_CHANGED',
      jsonb_build_object('type', 'SYSTEM', 'id', 'state-machine'),
      jsonb_build_object('failure_code', new.failure_code),
      old.status::text,
      new.status::text,
      false
    );
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Append-only guard for audit_events
--    Corrections are NEW events, never edits. Retention jobs set
--    set_config('app.allow_audit_mutation','on',true) to bypass.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_audit_mutation', true), '') <> 'on' then
    raise exception 'audit_events is append-only — write a new event instead';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Triggers
-- ---------------------------------------------------------------------------
create trigger wallets_updated_at     before update on public.wallets         for each row execute function public.set_updated_at();
create trigger intents_updated_at     before update on public.payment_intents  for each row execute function public.set_updated_at();
create trigger users_updated_at       before update on public.users            for each row execute function public.set_updated_at();
create trigger intents_state_guard    before update on public.payment_intents  for each row execute function public.validate_payment_transition();
create trigger intents_status_audit   after  update on public.payment_intents  for each row execute function public.record_status_audit();
create trigger audit_append_only      before update or delete on public.audit_events for each row execute function public.prevent_audit_mutation();

-- ---------------------------------------------------------------------------
-- 7. Indexes
-- ---------------------------------------------------------------------------
create index audit_correlation_idx  on public.audit_events (correlation_id);
create index audit_entity_idx       on public.audit_events (entity_id);
create index audit_event_type_idx   on public.audit_events (event_type);
create index audit_created_idx      on public.audit_events (created_at desc);
create index intents_user_idx       on public.payment_intents (user_id, created_at desc);
create index intents_correlation_idx on public.payment_intents (correlation_id);
create index routes_intent_idx      on public.routes (payment_intent_id, route_no);
create index compliance_intent_idx  on public.compliance_assessments (payment_intent_id);
create index risk_intent_idx        on public.risk_assessments (payment_intent_id);
create index approval_intent_idx    on public.approval_requests (payment_intent_id);
create index settlements_intent_idx on public.settlement_transactions (payment_intent_id);
create index receipts_owner_idx     on public.receipts (owner_address, issued_at desc);
create index wallets_user_idx       on public.wallets (user_id);

-- ---------------------------------------------------------------------------
-- 8. Row Level Security
-- ---------------------------------------------------------------------------

-- Helpers
create or replace function public.current_user_role()
returns user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

alter table public.users                 enable row level security;
alter table public.wallets               enable row level security;
alter table public.payment_intents       enable row level security;
alter table public.parsed_intents        enable row level security;
alter table public.qr_decoded            enable row level security;
alter table public.routes                enable row level security;
alter table public.compliance_assessments enable row level security;
alter table public.risk_assessments      enable row level security;
alter table public.approval_requests     enable row level security;
alter table public.approvals             enable row level security;
alter table public.settlement_transactions enable row level security;
alter table public.receipts              enable row level security;
alter table public.audit_events          enable row level security;

-- NOTE: if the Supabase dashboard auto-created any default policies, drop
-- them first (drop policy if exists ...) so only the rules below apply.

-- users
create policy "users_select_own" on public.users for select using (id = auth.uid() or public.current_user_role() = 'ADMIN');
create policy "users_update_own" on public.users for update using (id = auth.uid()) with check (id = auth.uid());

-- wallets
create policy "wallets_owner_all"  on public.wallets for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "wallets_admin_all"  on public.wallets for all using (public.current_user_role() = 'ADMIN') with check (true);

-- payment_intents — owner full CRUD; approver/auditor/operator read
create policy "intents_owner_all"  on public.payment_intents for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "intents_reader"     on public.payment_intents for select using (public.current_user_role() in ('APPROVER','AUDITOR','OPERATOR','ADMIN'));
create policy "intents_admin_all"  on public.payment_intents for all using (public.current_user_role() = 'ADMIN') with check (true);

-- child records follow their intent's ownership via EXISTS
create policy "parsed_owner_all"   on public.parsed_intents for all
  using (exists (select 1 from public.payment_intents pi where pi.id = parsed_intents.payment_intent_id and pi.user_id = auth.uid()))
  with check (exists (select 1 from public.payment_intents pi where pi.id = parsed_intents.payment_intent_id and pi.user_id = auth.uid()));
create policy "parsed_reader"      on public.parsed_intents for select
  using (public.current_user_role() in ('APPROVER','AUDITOR','OPERATOR','ADMIN'));

create policy "qr_owner_all"       on public.qr_decoded for all
  using (exists (select 1 from public.payment_intents pi where pi.id = qr_decoded.payment_intent_id and pi.user_id = auth.uid()))
  with check (exists (select 1 from public.payment_intents pi where pi.id = qr_decoded.payment_intent_id and pi.user_id = auth.uid()));
create policy "qr_reader"          on public.qr_decoded for select
  using (public.current_user_role() in ('APPROVER','AUDITOR','OPERATOR','ADMIN'));

create policy "routes_owner_all"   on public.routes for all
  using (exists (select 1 from public.payment_intents pi where pi.id = routes.payment_intent_id and pi.user_id = auth.uid()))
  with check (exists (select 1 from public.payment_intents pi where pi.id = routes.payment_intent_id and pi.user_id = auth.uid()));
create policy "routes_reader"      on public.routes for select
  using (public.current_user_role() in ('APPROVER','AUDITOR','OPERATOR','ADMIN'));

create policy "compliance_owner_all" on public.compliance_assessments for all
  using (exists (select 1 from public.payment_intents pi where pi.id = compliance_assessments.payment_intent_id and pi.user_id = auth.uid()))
  with check (exists (select 1 from public.payment_intents pi where pi.id = compliance_assessments.payment_intent_id and pi.user_id = auth.uid()));
create policy "compliance_reader"  on public.compliance_assessments for select
  using (public.current_user_role() in ('APPROVER','AUDITOR','OPERATOR','ADMIN'));

create policy "risk_owner_all"     on public.risk_assessments for all
  using (exists (select 1 from public.payment_intents pi where pi.id = risk_assessments.payment_intent_id and pi.user_id = auth.uid()))
  with check (exists (select 1 from public.payment_intents pi where pi.id = risk_assessments.payment_intent_id and pi.user_id = auth.uid()));
create policy "risk_reader"        on public.risk_assessments for select
  using (public.current_user_role() in ('APPROVER','AUDITOR','OPERATOR','ADMIN'));

-- approvals — APPROVER may write decisions on pending requests; owners read
create policy "approval_req_owner_read" on public.approval_requests for select
  using (exists (select 1 from public.payment_intents pi where pi.id = approval_requests.payment_intent_id and pi.user_id = auth.uid())
         or public.current_user_role() in ('APPROVER','AUDITOR','ADMIN'));
create policy "approval_req_insert"  on public.approval_requests for insert with check (true);
create policy "approval_req_approver_update" on public.approval_requests for update
  using (public.current_user_role() = 'APPROVER' and status = 'PENDING');
create policy "approval_req_admin"   on public.approval_requests for all using (public.current_user_role() = 'ADMIN') with check (true);

create policy "approvals_approver_all" on public.approvals for all
  using (approver_id = auth.uid() or public.current_user_role() in ('APPROVER','ADMIN'))
  with check (approver_id = auth.uid());
create policy "approvals_reader"       on public.approvals for select
  using (exists (select 1 from public.approval_requests ar
                 join public.payment_intents pi on pi.id = ar.payment_intent_id
                 where ar.id = approvals.approval_request_id and pi.user_id = auth.uid())
         or public.current_user_role() in ('AUDITOR','ADMIN'));

-- settlements / receipts — owner + approver/auditor read
create policy "settlements_owner_read" on public.settlement_transactions for select
  using (exists (select 1 from public.payment_intents pi where pi.id = settlement_transactions.payment_intent_id and pi.user_id = auth.uid())
         or public.current_user_role() in ('APPROVER','AUDITOR','ADMIN'));
create policy "settlements_service_insert" on public.settlement_transactions for insert with check (true);

create policy "receipts_owner_read" on public.receipts for select
  using (exists (select 1 from public.payment_intents pi where pi.id = receipts.payment_intent_id and pi.user_id = auth.uid())
         or exists (select 1 from public.wallets w where w.user_id = auth.uid() and w.address = receipts.owner_address)
         or public.current_user_role() in ('AUDITOR','ADMIN'));
create policy "receipts_service_insert" on public.receipts for insert with check (true);

-- audit_events — AUDITOR read-only all; owners read their own flow
create policy "audit_auditor_read" on public.audit_events for select
  using (public.current_user_role() = 'AUDITOR' or public.current_user_role() = 'ADMIN');
create policy "audit_owner_read" on public.audit_events for select
  using (exists (select 1 from public.payment_intents pi
                 where pi.correlation_id = audit_events.correlation_id and pi.user_id = auth.uid()));
-- No INSERT policy for end users: engine writes happen via Edge Functions with
-- the service-role key (which bypasses RLS). The trigger keeps it append-only.

-- ---------------------------------------------------------------------------
-- 9. Realtime — push status changes to the UI
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.payment_intents;
