# MOVA — Logging & Error-Handling Conventions

> **Phase 0 deliverable.** Foundation code in `packages/logger`. These
> conventions apply to every layer. They follow the `impeccable-code-quality`
> and `audit-trail` skills.

## Logging

### Levels

`fatal` > `error` > `warn` > `info` > `debug` > `trace`.

- `fatal` — process cannot continue (config violation, DB down).
- `error` — a request/flow failed; a `MovaError` was thrown and surfaced.
- `warn` — recoverable anomaly (provider slow, retryable, expired approval).
- `info` — lifecycle milestones (intent created, state transition, settled).
- `debug` — engine internals (guards evaluated, route candidates).
- `trace` — noisy per-call detail.

### Structured fields

Every line is JSON with: `time`, `level`, `msg`, plus context. Always include:

| Field | When |
| --- | --- |
| `correlationId` | Always — thread through every log in a payment flow |
| `service` / `env` / `version` | Set via `baseFields` |
| domain ids (`paymentIntentId`, `routeId`, ...) | Where available |
| `simulated` | When mock/simulated activity is involved |

Use `logger.child({ correlationId })` at flow boundaries so downstream code
never has to pass the id explicitly.

### Redaction

Never log secrets or PII: keys, mnemonics, private keys, passwords, tokens,
full counterparty identity. The logger redacts by field name
(`LOG_REDACT_FIELDS`); the signer/HTTP code must additionally never *emit*
those values at any level.

### Rules

1. JSON in production (`LOG_FORMAT=json`).
2. One flow → one `correlationId`.
3. Never log raw LLM prompts/outputs wholesale — log the parsed proposal and the
   validation outcome (raw output is persisted in the DB for audit).
4. No `console.log` in library code — use the `Logger` from `@mova/logger`.

## Error handling

### Typed errors

All failures throw `MovaError` with a stable `code` (see
`api-contracts.md` §4 for the code table). Factories exist for common cases
(`validationError`, `complianceBlocked`, `settlementFailed`, ...).

### Rules

1. **Fail fast and loudly.** Never `catch` and continue with bad state; never
   swallow errors.
2. **Validate at boundaries.** Every external input (including LLM output) is
   untrusted until a validator says otherwise.
3. **Fail closed for compliance.** If a compliance check or its data source
   errors → `REVIEW`/`BLOCK`, never `ALLOW`.
4. **No blind auto-retry on value movement.** A simulated/reverted submission is
   not retried automatically; it is audited and surfaced.
5. **Log-safe summaries.** Log via `toErrorSummary(err)`; include `correlationId`
   and `code`; never log `err.stack` of secrets, and never log the full error
   object if it may contain sensitive context.
6. **Audit, don't just log.** Decisions and state changes go to `AuditService`
   (append-only). Logs are operational; audit events are evidence.

### Example

```ts
try {
  const out = sm.apply(state, event);
  if (!out.ok) throw new MovaError(ErrorCode.STATE_TRANSITION_INVALID, out.reason ?? "invalid transition");
  await audit.record({ ...transitionAudit, previousState: out.from, newState: out.to });
} catch (err) {
  logger.child({ correlationId }).error("transition failed", { error: toErrorSummary(err) });
  throw err;
}
```

## Money & numbers (cross-cutting)

- `Money { asset, amount }`, `amount` in smallest units as a decimal string.
- Integer math only (`BigInt`); no floats.
- Human-readable amounts are rendered in the UI only, from the smallest-unit
  value.

## Naming & code conventions

- Packages: `@mova/*`. Domain types in `packages/types`; contracts in
  `packages/core`; providers in `packages/integrations`.
- Enums/statuses are closed string unions (no free strings across boundaries).
- No dead code, no magic values, no commented-out code.
- Every state transition and decision is covered by a deterministic unit test
  (see `roadmap.md`).

## Delivery gates (per `flawless-delivery`)

- Typecheck passes (`npm run typecheck`), tests pass, lint clean.
- Changes that move value or change a decision require review + a complete audit
  trail, and a described rollback.
- Docs and foundation code stay in sync — a design change updates BOTH.
