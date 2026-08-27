# MOVA — API & Interface Contracts

> **Phase 0 deliverable.** Three layers of contract: (1) internal module
> interfaces (TypeScript), (2) the HTTP API surface, (3) the event/audit
> contract. Internal interfaces are defined in
> `packages/core/src/interfaces.ts`; DTO validation uses Zod (Phase 1).

## 1. Internal module interfaces

Modules talk only through these contracts. The AI layer appears exactly once
(`IntentParser`), producing a proposal.

| Interface | Method(s) | Produces | Notes |
| --- | --- | --- | --- |
| `IntentParser` *(AI/Gemini)* | `parse(rawText, ctx)` | `ParsedIntentProposal` | Suggestion only |
| `QrDecoder` *(deterministic, local)* | `decode(payload)` | `QrDecoded` | Local EMVCo decode (`packages/qr`); trusted amount/account |
| `IntentValidator` | `validate(proposal, intent)` | `ParsedIntent` | Pure, deterministic; recomputes money |
| `RouteDiscovery` | `discover(intent, parsed)` | `RouteCandidate[]` | Uses `MarketDataProvider` |
| `RouteOptimizer` | `optimize(candidates, criterion)` | `{ routes, selected }` | Pure ranking |
| `ComplianceEngine` | `assess(intent, route)` | `ComplianceAssessment` | Fail-closed `ALLOW/REVIEW/BLOCK` |
| `RiskEngine` | `assess(intent, route, portfolio)` | `RiskAssessment` | Deterministic band + signals |
| `HedgingEngine` | `recommend(parsed, risk)` | `HedgingPlan` | Wraps `HedgingProvider` |
| `ApprovalService` | `createRequest` / `recordDecision` / `getStatus` | `ApprovalRequest` | Threshold + expiry |
| `ExecutionService` | `buildPlan` / `simulate` / `execute` | `SettlementTransaction` | Only value-moving path |
| `PaymentStateMachine` | `apply(from, event)` | `TransitionOutcome` | Guarded transitions |
| `AuditService` | `record` / `listByCorrelation` | `AuditEvent` | Append-only |
| `PaymentOrchestrator` | `createFromText` / `createFromQr` / `approve` / `execute` / `getStatus` | `PaymentIntent` | Phase 1 impl |
| `WalletService` | `listByUser` / `getOperatingWallet` | `Wallet[]` / `Wallet` | |

### Provider contracts (`packages/integrations`)

| Provider | Method(s) | Replaced-by (real) |
| --- | --- | --- |
| `SettlementProvider` | `submit(params)` / `getStatus(digest)` | Sui (`@mysten/sui`, Mainnet target) |
| `HedgingProvider` | `quote(request)` | Thetanuts V4 / Optionbook |
| `MarketDataProvider` | `getQuote(request)` | Real price feed / oracle |
| `ScreeningProvider` | `screen(request)` | Sanctions/watchlist vendor |

All provider interfaces expose a `descriptor` (`{ kind: MOCK | REAL, name, network }`)
so the audit trail records which implementation produced a result.

## 2. HTTP API surface (Supabase Edge Functions, Phase 1)

All routes are JSON under `/functions/v1/...`; auth via Supabase JWT (roles
enforced by RLS + function role checks); errors follow the error contract (§4).
Status changes are pushed over **Supabase Realtime** (`postgres_changes` on
`payment_intents.status` for the flow's `correlationId`).

### Intents & status

| Method & path | Purpose | Key transitions |
| --- | --- | --- |
| `POST /functions/v1/intents` | Create intent from `{ rawText }` (chat) or structured body | → `CREATED`, `PARSED` |
| `POST /functions/v1/intents/qr` | Local EMVCo decode → create intent | → `CREATED` |
| `GET /functions/v1/intents/:id` | Intent + latest state + summary | |
| `GET /functions/v1/intents/:id/status` | Current `PaymentState` + `failureCode` | |
| `GET /functions/v1/intents/:id/audit` | Full audit trail for the flow | |

### Compliance & risk

| Method & path | Purpose |
| --- | --- |
| `POST /functions/v1/intents/:id/compliance/assess` | (Re)run compliance pipeline (engine-only; decision recorded) |
| `GET /functions/v1/intents/:id/compliance` | Latest `ComplianceAssessment` |
| `GET /functions/v1/intents/:id/risk` | Latest `RiskAssessment` incl. hedging plan |
| `POST /functions/v1/intents/:id/risk/hedge-quote` | Deterministic hedge quote via `HedgingProvider` |

### Approval & execution

| Method & path | Purpose | Key transitions |
| --- | --- | --- |
| `POST /functions/v1/intents/:id/approvals` | Create approval request | → `AWAITING_APPROVAL` |
| `POST /functions/v1/intents/:id/approvals/:requestId/decision` | Human `APPROVE / REJECT` | → `APPROVED` / `FAILED` |
| `GET /functions/v1/intents/:id/approvals/:requestId` | Approval status + who has decided |
| `POST /functions/v1/intents/:id/simulate` | `ExecutionService.simulate` (no chain interaction) | |
| `POST /functions/v1/intents/:id/execute` | Submit settlement **only if `APPROVED`** | → `EXECUTING` |

### Wallets & reference

| Method & path | Purpose |
| --- | --- |
| `GET /functions/v1/wallets` | Wallets for the authenticated user |
| `GET /functions/v1/portfolio` | Deterministic portfolio snapshot (for `RiskEngine`) |

Status updates are pushed over **Supabase Realtime** (`postgres_changes` on
`payment_intents` filtered by the flow's `correlationId`).

### Authn / authz (Phase 1)

- Supabase Auth provides identity; roles live in app metadata / the `User` table.
- `APPROVER` role required for approval decisions.
- `AUDITOR` role (read-only) for the audit trail.
- `OWNER`/`OPERATOR` for intent creation.
- Enforced by RLS policies + Edge Function role checks per `environment.md`.

## 3. Event / audit contract

Every domain event is persisted as an `AuditEvent` (append-only) with a shared
`correlationId`. Canonical event names:

```
INTENT_CREATED        INTENT_PARSED          INTENT_VALIDATED
INTENT_INVALID        ROUTES_FOUND           ROUTE_SELECTED
COMPLIANCE_DECIDED    RISK_ASSESSED          HEDGE_PLANNED
APPROVAL_REQUESTED    APPROVAL_DECIDED       APPROVAL_EXPIRED
EXECUTION_PLANNED     EXECUTION_SIMULATED    EXECUTION_SUBMITTED
SETTLED               EXECUTION_FAILED       PAYMENT_FAILED
```

Each event includes: `correlationId`, `entityType`, `entityId`, `eventType`,
`actor { type, id }`, `payload` (full decision context), `previousState`,
`newState`, `simulated`, `timestamp`.

State-machine transitions map 1:1 to these events (e.g. `COMPLIANCE_DECIDED`
with `BLOCK` emits the `COMPLIANCE_CHECKED → FAILED` transition).

## 4. Error contract

Errors are `MovaError` (`packages/logger/src/errors.ts`) with stable codes.
HTTP responses use the same codes as `error.code`.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `ERR_VALIDATION` | 400 | Invalid request / intent |
| `ERR_INTENT_VALIDATION` | 422 | Parsed intent failed validation |
| `ERR_NOT_FOUND` | 404 | Entity not found |
| `ERR_ROUTING_FAILED` | 500 | No route found |
| `ERR_COMPLIANCE_BLOCKED` | 403 | Compliance decision = BLOCK |
| `ERR_COMPLIANCE_UNAVAILABLE` | 503 | Compliance engine failed → fail-closed REVIEW/BLOCK |
| `ERR_RISK_BLOCKED` | 403 | Risk decision = BLOCK |
| `ERR_APPROVAL_REQUIRED` | 403 | Execution attempted without approval |
| `ERR_APPROVAL_REJECTED` / `ERR_APPROVAL_EXPIRED` | 409 | Approval resolved against execution |
| `ERR_EXECUTION_SIMULATION` | 409 | Simulation failed (never auto-retry) |
| `ERR_SETTLEMENT_FAILED` | 502 | Chain submission failed |
| `ERR_SETTLEMENT_UNCONFIRMED` | 502 | Timeout waiting for confirmation |
| `ERR_STATE_TRANSITION` | 409 | Illegal state transition |
| `ERR_INTEGRATION_UNAVAILABLE` | 503 | Sponsor unavailable |
| `ERR_MOCK_FORBIDDEN` | 500 | Mock used in a boundary that forbids it |
| `ERR_UNAUTHORIZED` / `ERR_FORBIDDEN` | 401 / 403 | Authn / authz |
| `ERR_CONFIGURATION` | 500 | Boot-time config/boundary violation |
| `ERR_INTERNAL` | 500 | Unexpected |

Response shape: `{ "error": { "code": "…", "message": "…", "correlationId": "…" } }`.

Rules: never swallow errors; never auto-retry a reverted submission; compliance
failures default to `REVIEW`/`BLOCK` (fail-closed); every error that touches a
decision is audited.
