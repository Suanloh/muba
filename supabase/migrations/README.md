# MOVA — Supabase Migrations

**Initial schema shipped** in [`0001_init.sql`](0001_init.sql).

Migration policy (per `docs/conventions.md`):

- Forward-only migrations; reviewed before applying.
- Tables mirror `packages/types/src/domain.ts`.
- `audit_events` is **append-only** — no UPDATE/DELETE grants except for
  retention jobs (`set_config('app.allow_audit_mutation','on',true)`);
  corrections are new events.
- **RLS is the enforcement layer**:
  - `OWNER` → full CRUD on own intents/wallets.
  - `APPROVER` → read intent/route/compliance/risk + write `approvals`.
  - `AUDITOR` → read-only on audit trail.
  - `OPERATOR` → create intents, read pipeline state.
  - service role → engine writes (state transitions via Edge Functions).

## `0001_init.sql` — what it sets up

- Enums mirroring `packages/types/src/enums.ts` (network, payment_state,
  roles, decisions, …).
- Core tables: `users`, `wallets`, `payment_intents`, `parsed_intents`,
  `qr_decoded`, `routes`, `compliance_assessments`, `risk_assessments`,
  `approval_requests`, `approvals`, `settlement_transactions`, `receipts`,
  and the append-only `audit_events`.
- Money stored as `{asset, amount}` TEXT pairs (smallest units, decimal
  string) — never floats.
- **State-machine guard**: `validate_payment_transition()` blocks illegal
  `payment_intents.status` transitions and requires `failure_code` on FAILED.
- **Status audit trigger**: any status change auto-writes an `audit_events`
  row (`SECURITY DEFINER` so auditing can never be skipped).
- Indexes on `correlation_id`, `entity_id`, `event_type`, `user_id`, etc.
- Full RLS policies per role (OWNER / APPROVER / AUDITOR / OPERATOR / ADMIN).
- Realtime: `payment_intents` published to `supabase_realtime` for status push.

> TODO (Phase 1): Edge Functions, compliance config/versioned watchlist tables,
> and the Drizzle schema in `packages/db`.
