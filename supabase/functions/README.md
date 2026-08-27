# MOVA — Edge Functions

**Phase 0 placeholder.** Implemented in Phase 1 (see `docs/roadmap.md`).

Each function exposes the HTTP contract in `docs/api-contracts.md` and runs the
deterministic engines from `packages/core` + providers from
`packages/integrations`. Auth via Supabase JWT; role checks against the `User`
table (or Supabase app_metadata).

| Function | Route (Phase 1) | Purpose |
| --- | --- | --- |
| `intents` | `POST/GET /functions/v1/intents` | Create (text or QR), status, audit |
| `approvals` | `POST /functions/v1/approvals` | Create request / record decision |
| `compliance` | `POST /functions/v1/compliance/assess` | Run/read compliance |
| `risk` | `POST /functions/v1/risk/assess` | Run/read risk + hedge quote |
| `execute` | `POST /functions/v1/execute` | Simulate + settle (only if `APPROVED`) |
