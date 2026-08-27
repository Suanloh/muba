# MOVA — Supabase Migrations

**Phase 0 placeholder.** Implemented in Phase 1 (see `docs/roadmap.md`).

Migration policy (per `docs/conventions.md`):

- Forward-only migrations; reviewed before applying.
- Tables mirror `packages/types/src/domain.ts`.
- `audit_events` is **append-only** — no UPDATE/DELETE grants except for
  retention jobs; corrections are new events.
- **RLS is the enforcement layer**:
  - `OWNER` → full CRUD on own intents/wallets.
  - `APPROVER` → read intent/route/compliance/risk + write `approvals`.
  - `AUDITOR` → read-only on audit trail.
  - `OPERATOR` → create intents, read pipeline state.
  - service role → engine writes (state transitions via Edge Functions).
