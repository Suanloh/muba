# MOVA Web — Frontend

**Phase 0 placeholder.** Implemented in Phase 1.

Stack (per `docs/architecture.md` and the `fintech-system-architecture` skill):

- **Next.js (App Router)** + React + TypeScript + Tailwind + **Supabase client**.
- Views: chat-style intent composer, **QR scanner (local EMVCo decode)**, payment
  timeline with the state machine, compliance/risk panels, approval UI, audit
  viewer, wallet dashboard.
- Reads via the RLS-scoped Supabase client + Realtime status; invokes Edge
  Functions (`/functions/v1/...`) for intents / approvals / execute.
- No business logic or execution code in the UI layer; service-role keys never
  appear in the client bundle.
