# MOVA — Data Layer (packages/db)

**Phase 0 placeholder.** Implemented in **Phase 1** (see `docs/roadmap.md`).

- Supabase PostgreSQL + Drizzle schema mirroring `packages/types/src/domain.ts`.
- Append-only `audit_events` store (indexed by `correlationId`, `entityId`,
  `eventType`, `timestamp`).
- Versioned compliance configuration (policies, limits, watchlist data).
- Migration policy: forward-only, reviewed; audit table is never
  updated/deleted in normal operation.

The canonical entity definitions live in `packages/types`; this package turns
them into a durable store.
