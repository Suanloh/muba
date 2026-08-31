# MOVA — Supabase Backend

**Implemented (Phase 17).** Supabase is MOVA's backend platform:

| Concern | Supabase service |
| --- | --- |
| Database | Supabase PostgreSQL (business store + append-only audit) |
| Auth | Supabase Auth (OWNER / APPROVER / OPERATOR / AUDITOR roles) |
| API layer | Edge Functions (`mova-sync` — the privileged writer) |
| Realtime | Supabase Realtime (`postgres_changes`) for status push to the UI |
| RLS | Row Level Security as the enforcement layer for role access |

## Layout

```
supabase/
├── config.toml            # local dev config
├── functions/
│   ├── _shared/cors.ts    # CORS + JSON helpers
│   └── mova-sync/         # the only privileged writer (service-role key)
└── migrations/
    ├── 0001_init.sql      # schema, RLS, state machine, audit triggers, realtime
    └── 0002_sync_meta.sql # payment_intents.meta jsonb + demo-owner helper
```

## Edge Functions

| Function | Purpose |
| --- | --- |
| `mova-sync` | POST `{kind: intent|audit|receipt, item}` → service-role write; GET `?kind=audit&correlationId=` → read trail; GET `?kind=health` → probe |

Deploy: `supabase functions deploy mova-sync --no-verify-jwt`.

The web app never holds the service-role key. It POSTs to `mova-sync`; the
function writes with the service-role key (bypassing RLS as intended), keeping
RLS intact for any future Auth-scoped reads. A deterministic demo-owner user
(derived from the wallet address) satisfies the `user_id` FK when there is no
Auth session.

## How the pieces fit

1. UI (`apps/web`, Next.js) talks to Supabase via `@mova/db` — the anon client
   for Realtime subscriptions, the `mova-sync` Edge Function for writes.
2. `apps/web/lib/supabase/mova-db.ts` builds the `MovaDb` facade from
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. When they're
   missing the app runs fully in-memory and every sync honestly reports
   `offline: true` (Settings → "Data layer · Supabase").
3. Status changes are pushed to the UI over Realtime `postgres_changes` on
   `payment_intents.status` and reconciled into the in-memory store.
4. The audit log is append-only at the DB level (trigger); corrections are new
   events; the `mova-sync` function never bypasses the state-machine guard on
   `payment_intents.status`.

> Note: Edge Functions run on Deno. `mova-sync` is self-contained (supabase-js
> only) so it deploys without bundling the workspace packages.
