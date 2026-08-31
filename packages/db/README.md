# MOVA — Data Layer (packages/db)

**Implemented.** Supabase (PostgreSQL + Realtime) with an honest offline fallback.

## What it provides

- **Typed Supabase client factories** (`createMovaBrowserClient` / `createMovaAdminClient`)
  with a hand-maintained `Database` schema mirroring `supabase/migrations/*.sql`.
- **`MovaDb` facade** — the single data-access object the rest of MOVA uses:
  - `syncIntent` / `syncAudit` / `syncReceipt` — write through the `mova-sync`
    Edge Function (service-role key stays server-side; the browser never holds it).
  - `listAudit(correlationId)` — read the append-only audit trail.
  - `ping()` — probe the Edge Function (reachability).
  - `subscribeToStatus(cb)` — Realtime `postgres_changes` on `payment_intents`.
  - `status: "online" | "offline"` + `reason` — honest about connectivity.
- **Offline mode** — when `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  are missing, every sync returns `{ ok:false, offline:true }` and the app keeps
  running in-memory. Nothing is ever fabricated as persisted.

## Wire a live backend

```bash
# 1. Apply migrations (local: supabase start, then supabase db push)
supabase db push

# 2. Deploy the privileged writer
supabase functions deploy mova-sync --no-verify-jwt

# 3. Point the app at it (apps/web/.env.local)
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

The Settings → "Data layer · Supabase" panel shows live connection status, sync
counters, Realtime events and the last error.

## Contract notes

- Writes go through the Edge Function with the service-role key; RLS stays
  intact (the migration grants end-users no privileged INSERT).
- `audit_events` is append-only at the DB level; corrections are new events.
- `payment_intents.status` transitions are guarded by the state-machine trigger;
  the `mova-sync` function never bypasses it.
- Tests: `npm run test -w @mova/db`.
