# MOVA — Edge Functions

**Implemented (Phase 17).**

Each function exposes the HTTP contract the web app consumes. Writes use the
service-role key (server-side only); reads the web app may make go through the
function so RLS stays intact for the demo (no Auth session).

| Function | Route | Purpose |
| --- | --- | --- |
| `mova-sync` | `POST /functions/v1/mova-sync` | Persist `{kind: intent|audit|receipt, item}` with the service-role key |
| `mova-sync` | `GET /functions/v1/mova-sync?kind=audit&correlationId=<id>` | Read the append-only audit trail for a correlation |
| `mova-sync` | `GET /functions/v1/mova-sync?kind=health` | Connection probe (used by the Settings panel) |

Deploy: `supabase functions deploy mova-sync --no-verify-jwt` (no JWT required —
the demo has no Auth session; RLS stays intact because writes go through the
service role). Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the function
environment (Supabase injects these automatically when deployed to a project).
