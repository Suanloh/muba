# MOVA — Supabase Backend

**Phase 0 scaffold.** Supabase is MOVA's backend platform:

| Concern | Supabase service |
| --- | --- |
| Database | Supabase PostgreSQL (business store + append-only audit) |
| Auth | Supabase Auth (OWNER / APPROVER / OPERATOR / AUDITOR roles) |
| API layer | Edge Functions (Deno) running the deterministic `@mova/*` engines |
| Realtime | Supabase Realtime (`postgres_changes`) for status push to the UI |
| RLS | Row Level Security as the enforcement layer for role access |

## Layout

```
supabase/
├── config.toml            # local dev config
├── functions/             # Edge Functions (the HTTP API — Phase 1)
└── migrations/            # SQL migrations incl. RLS + audit tables (Phase 1)
```

## Edge Functions (Phase 1)

Planned functions map to `docs/api-contracts.md`:

- `intents`      — create intent (text or QR), get status, list audit
- `approvals`    — create request, record decision
- `compliance`   — run/read compliance assessment
- `risk`         — run/read risk assessment + hedge quote
- `execute`      — simulate + execute (only when `APPROVED`)

Each function imports the deterministic engines from `packages/core` and
providers from `packages/integrations` (bundled at deploy). The AI layer
(`packages/ai`) runs only the Gemini `IntentParser` — proposals only, never
execution.

## How the pieces fit

1. UI (`apps/web`, Next.js) talks to Supabase via the client SDK (anon key,
   RLS). "Owner" writes pass RLS; "approver/auditor" reads pass RLS.
2. Sensitive/complex operations (running deterministic engines, settlement,
   approval threshold) go through Edge Functions with the service-role key
   server-side only.
3. Status changes are pushed to the UI over Realtime `postgres_changes` on
   `payment_intents.status`.
4. The audit log is append-only; RLS grants `INSERT` to the service role and
   `SELECT` to `AUDITOR` only (see `migrations/` in Phase 1).

> Note: Edge Functions run on Deno. The `@mova/*` workspace packages are pure
> TypeScript (no Node-specific APIs in `core`/`qr`/`types`) so they bundle into
> Edge Functions. `@mova/logger` uses `console` only, which Deno supports.
